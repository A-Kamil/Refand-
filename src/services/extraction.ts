import type { z } from "zod";
import { getDefaultCaller, type LlmCaller, type StructuredRequest, type StructuredResponse } from "../ai/client.js";
import { DOCUMENT_ANALYST_SYSTEM_PROMPT } from "../ai/prompts.js";
import {
  ContractExtractionSchema,
  InvoiceExtractionSchema,
  type ContractExtraction,
  type InvoiceExtraction,
} from "../ai/schemas.js";
import { EngineError, isEngineError } from "../errors.js";
import type {
  ContractRate,
  DocumentInput,
  DocumentKind,
  ExtractedData,
  FreightInvoice,
  InvoiceLine,
  ParsedDocument,
} from "../types/shared.js";
import { locateExcerpt, type LocatableDocument } from "./evidence.js";
import {
  collapseWhitespace,
  isIsoDate,
  normalizeChargeType,
  normalizeCurrency,
  normalizeRateBasis,
  parseAmountToMinor,
} from "./normalization.js";

/**
 * AI extraction pipeline: LLM response -> JSON.parse -> Zod schema -> business validation -> ExtractedData.
 * The model's output is never trusted directly: amounts, dates, currencies and quantities are re-parsed
 * by code, evidence is re-located in the parsed text, and anything doubtful becomes `null` + a warning.
 */

export type ExtractionInput = ParsedDocument | DocumentInput | string;

export type ExtractionDocument = LocatableDocument & { kind: DocumentKind; text: string };

export type ExtractionOptions = { llm?: LlmCaller };

export type InvoiceParseResult = { invoice: FreightInvoice; warnings: string[] };

export type ContractParseResult = {
  contractNumber: string | null;
  carrier: string | null;
  rates: ContractRate[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function extractDocuments(
  invoice: ExtractionInput,
  contract: ExtractionInput,
  options: ExtractionOptions = {},
): Promise<ExtractedData> {
  const invoiceDoc = toExtractionDocument(invoice, "INVOICE");
  const contractDoc = toExtractionDocument(contract, "CONTRACT");
  const llm = options.llm ?? getDefaultCaller();

  const [invoiceResponse, contractResponse] = await Promise.all([
    callModel(llm, buildExtractionRequest(invoiceDoc)),
    callModel(llm, buildExtractionRequest(contractDoc)),
  ]);

  const invoiceResult = parseInvoiceOutput(invoiceResponse.raw, invoiceDoc);
  const contractResult = parseContractOutput(contractResponse.raw, contractDoc);
  const models = [...new Set([invoiceResponse.model, contractResponse.model])];
  return buildExtractedData(invoiceResult, contractResult, { method: "AI", model: models.join(", ") });
}

export function buildExtractedData(
  invoiceResult: InvoiceParseResult,
  contractResult: ContractParseResult,
  meta: { method: "AI" | "FIXTURE"; model?: string; extractedAt?: string },
): ExtractedData {
  const out: ExtractedData = {
    invoice: invoiceResult.invoice,
    rates: contractResult.rates,
    warnings: [...invoiceResult.warnings, ...contractResult.warnings],
    meta: { method: meta.method, extractedAt: meta.extractedAt ?? new Date().toISOString() },
  };
  if (meta.model) out.meta.model = meta.model;
  return out;
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export function toExtractionDocument(input: ExtractionInput, kind: DocumentKind): ExtractionDocument {
  const fallbackId = kind === "INVOICE" ? "invoice" : "contract";
  let doc: ExtractionDocument;
  if (typeof input === "string") {
    doc = { documentId: fallbackId, filename: `${fallbackId}.txt`, kind, text: input, pages: [input], pageNumbered: false };
  } else {
    if ("kind" in input && input.kind !== kind) {
      throw new EngineError("INVALID_INPUT", `Expected a ${kind.toLowerCase()} document, got ${input.kind.toLowerCase()} "${input.filename}".`);
    }
    const pages = input.pages && input.pages.length > 0 ? input.pages : [input.text];
    doc = {
      documentId: input.documentId,
      filename: input.filename,
      kind,
      text: input.text,
      pages,
      pageNumbered: input.pageNumbered ?? false,
    };
  }
  if (collapseWhitespace(doc.text).length === 0) {
    throw new EngineError("EMPTY_DOCUMENT", `The ${kind.toLowerCase()} document "${doc.filename}" contains no text.`);
  }
  return doc;
}

const TASK_INSTRUCTIONS: Record<DocumentKind, string> = {
  INVOICE:
    "Extract the invoice header and every invoice line from the document above, following the system rules and the JSON schema.",
  CONTRACT:
    "Extract the contract header and every contractual rate from the document above, following the system rules and the JSON schema.",
};

/** Document text is passed only inside <document> tags, as data. Tag look-alikes inside the text are neutralised. */
export function buildExtractionRequest(doc: ExtractionDocument): StructuredRequest {
  const body = doc.text.replace(/<(\/?)(document)/giu, "&lt;$1$2");
  const content =
    `<document filename="${escapeAttribute(doc.filename)}" kind="${doc.kind}">\n${body}\n</document>\n\n` +
    TASK_INSTRUCTIONS[doc.kind];
  return {
    label: doc.kind === "INVOICE" ? "invoice extraction" : "contract extraction",
    system: DOCUMENT_ANALYST_SYSTEM_PROMPT,
    content,
    schema: doc.kind === "INVOICE" ? InvoiceExtractionSchema : ContractExtractionSchema,
  };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

async function callModel(llm: LlmCaller, request: StructuredRequest): Promise<StructuredResponse> {
  try {
    return await llm(request);
  } catch (error) {
    if (isEngineError(error)) throw error;
    throw new EngineError("AI_REQUEST_FAILED", `AI request failed during ${request.label}.`, String(error));
  }
}

// ---------------------------------------------------------------------------
// Raw output -> validated schema
// ---------------------------------------------------------------------------

function parseRaw<T>(raw: string, schema: z.ZodType<T>, label: string): T {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim());
  } catch {
    throw new EngineError("INVALID_AI_OUTPUT", `AI output for ${label} is not valid JSON.`);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`);
    throw new EngineError("INVALID_AI_OUTPUT", `AI output for ${label} does not match the expected schema.`, { issues });
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Business validation helpers
// ---------------------------------------------------------------------------

function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = collapseWhitespace(value);
  return v.length > 0 ? v : null;
}

function requireText(value: string | null | undefined, what: string, warnings: string[]): string | null {
  const v = cleanText(value);
  if (v === null) warnings.push(`${what} not stated.`);
  return v;
}

function validDate(value: string | null | undefined, what: string, warnings: string[], warnIfMissing = true): string | null {
  const v = cleanText(value);
  if (v === null) {
    if (warnIfMissing) warnings.push(`${what} not stated.`);
    return null;
  }
  if (!isIsoDate(v)) {
    warnings.push(`${what} "${v}" is not a valid YYYY-MM-DD date; ignored.`);
    return null;
  }
  return v;
}

function amountMinor(text: string | null | undefined, what: string, warnings: string[], warnIfMissing = true): number | null {
  const v = cleanText(text);
  if (v === null) {
    if (warnIfMissing) warnings.push(`${what} not stated.`);
    return null;
  }
  const parsed = parseAmountToMinor(v);
  if (!parsed.ok) {
    warnings.push(`${what}: ${parsed.reason}; amount left empty.`);
    return null;
  }
  return parsed.minor;
}

const AMOUNT_CURRENCY_PREFIX = /^(EUR|USD|GBP|CHF|€|\$|£)|(EUR|USD|GBP|CHF|€|\$|£)$/iu;

/** Currency printed next to an amount, e.g. "EUR 42,500.00" or "42 500,00 €". */
function currencyFromAmount(text: string | null | undefined): string | null {
  const v = cleanText(text);
  if (v === null) return null;
  const m = v.match(AMOUNT_CURRENCY_PREFIX);
  return normalizeCurrency(m?.[1] ?? m?.[2] ?? null);
}

/** Explicit field, else currency printed on the amount, else the document-level currency (if the document states one). */
function resolveCurrency(
  field: string | null,
  amountText: string | null,
  documentCurrency: string | null,
  what: string,
  warnings: string[],
): string | null {
  const explicit = normalizeCurrency(field);
  if (field !== null && cleanText(field) !== null && explicit === null) {
    warnings.push(`${what}: unrecognised currency "${field}".`);
  }
  const printed = currencyFromAmount(amountText);
  if (explicit && printed && explicit !== printed) {
    warnings.push(`${what}: currency ${explicit} conflicts with amount "${amountText}"; currency left empty.`);
    return null;
  }
  const currency = explicit ?? printed ?? documentCurrency;
  if (currency === null) warnings.push(`${what}: currency not stated.`);
  return currency;
}

function positiveInteger(value: number | null, what: string, warnings: string[]): number | null {
  if (value === null) {
    warnings.push(`${what} not stated.`);
    return null;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    warnings.push(`${what} ${value} is not a positive whole number; ignored.`);
    return null;
  }
  return value;
}

function checkAmountInExcerpt(amountText: string | null, excerpt: string, what: string, warnings: string[]): void {
  const amount = cleanText(amountText);
  if (amount === null) return;
  const squash = (s: string) => collapseWhitespace(s).replace(/\s/gu, "");
  if (!squash(excerpt).includes(squash(amount))) {
    warnings.push(`${what}: amount "${amount}" does not appear in its excerpt.`);
  }
}

function route(origin: string | null, destination: string | null): string | null {
  return origin && destination ? `${origin} → ${destination}` : null;
}

function uniqueId(base: string, index: number, seen: Set<string>, what: string, warnings: string[]): string {
  let id = base;
  if (seen.has(id)) {
    id = `${base}~${index + 1}`;
    warnings.push(`${what}: duplicate id "${base}", renamed "${id}".`);
  }
  seen.add(id);
  return id;
}

function aiWarnings(warnings: string[], doc: ExtractionDocument): string[] {
  return warnings.map(cleanText).filter((w): w is string => w !== null).map((w) => `[AI] ${doc.filename}: ${w}`);
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export function parseInvoiceOutput(raw: string, doc: ExtractionDocument): InvoiceParseResult {
  const out: InvoiceExtraction = parseRaw(raw, InvoiceExtractionSchema, `invoice "${doc.filename}"`);
  const warnings = aiWarnings(out.warnings, doc);
  const w: string[] = [];
  const where = `Invoice ${doc.filename}`;

  const invoiceNumber = requireText(out.invoiceNumber, `${where}: invoice number`, w);
  const carrier = requireText(out.carrier, `${where}: carrier`, w);
  const shipmentId = requireText(out.shipmentId, `${where}: shipment ID`, w);
  const invoiceDate = validDate(out.invoiceDate, `${where}: invoice date`, w);
  const shipmentDate = validDate(out.shipmentDate, `${where}: shipment date`, w);
  const origin = requireText(out.origin, `${where}: origin port`, w);
  const destination = requireText(out.destination, `${where}: destination port`, w);
  const containerType = requireText(out.containerType, `${where}: container type`, w);
  const currency = normalizeCurrency(out.currency) ?? currencyFromAmount(out.invoiceTotalText);
  if (currency === null) w.push(`${where}: document currency not stated.`);
  const totalMinor = amountMinor(out.invoiceTotalText, `${where}: invoice total`, w);

  const seen = new Set<string>();
  const lines: InvoiceLine[] = out.lines.map((line, i) => {
    const label = `Invoice line ${line.lineNumber ?? i + 1}`;
    let lineNumber: number | null = line.lineNumber;
    if (lineNumber !== null && (!Number.isSafeInteger(lineNumber) || lineNumber <= 0)) {
      w.push(`${label}: line number ${lineNumber} is not a positive whole number; ignored.`);
      lineNumber = null;
    }
    const id = uniqueId(`${invoiceNumber ?? doc.documentId}#${lineNumber ?? i + 1}`, i, seen, label, w);
    const chargeLabel = cleanText(line.chargeLabel) ?? "";
    if (chargeLabel === "") w.push(`${label}: charge label not stated.`);
    const amountText = cleanText(line.amountText);
    checkAmountInExcerpt(amountText, line.excerpt, label, w);

    const source = locateExcerpt(doc, line.excerpt);
    if (!source.verified) w.push(`Excerpt for ${label} not found verbatim in ${doc.filename}.`);

    return {
      id,
      lineNumber,
      description: cleanText(line.description) ?? chargeLabel,
      chargeType: normalizeChargeType(chargeLabel),
      chargeLabel,
      quantity: positiveInteger(line.quantity, `${label}: quantity`, w),
      unitPriceMinor: amountMinor(line.unitPriceText, `${label}: unit price`, w, false),
      amountMinor: amountMinor(amountText, `${label}: amount`, w),
      currency: resolveCurrency(line.currency, amountText, currency, label, w),
      source,
    };
  });
  if (lines.length === 0) w.push(`${where}: no invoice lines extracted.`);

  const invoice: FreightInvoice = {
    documentId: doc.documentId,
    filename: doc.filename,
    invoiceNumber,
    carrier,
    shipmentId,
    invoiceDate,
    shipmentDate,
    currency,
    origin,
    destination,
    route: route(origin, destination),
    containerType,
    totalMinor,
    lines,
  };
  return { invoice, warnings: [...warnings, ...w] };
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export function parseContractOutput(raw: string, doc: ExtractionDocument): ContractParseResult {
  const out: ContractExtraction = parseRaw(raw, ContractExtractionSchema, `contract "${doc.filename}"`);
  const warnings = aiWarnings(out.warnings, doc);
  const w: string[] = [];
  const where = `Contract ${doc.filename}`;

  const contractNumber = requireText(out.contractNumber, `${where}: contract number`, w);
  const carrier = requireText(out.carrier, `${where}: carrier`, w);
  const currency = normalizeCurrency(out.currency);
  if (cleanText(out.currency) !== null && currency === null) w.push(`${where}: unrecognised currency "${out.currency}".`);
  const contractFrom = validDate(out.validFrom, `${where}: validity start`, w);
  const contractTo = validDate(out.validTo, `${where}: validity end`, w);

  const seen = new Set<string>();
  const rates: ContractRate[] = out.rates.map((rate, i) => {
    const section = cleanText(rate.section);
    const label = `Contract rate ${section ?? i + 1}`;
    const id = uniqueId(`${contractNumber ?? doc.documentId}#${section ?? i + 1}`, i, seen, label, w);
    const chargeLabel = cleanText(rate.chargeLabel) ?? "";
    if (chargeLabel === "") w.push(`${label}: charge label not stated.`);
    const origin = requireText(rate.origin, `${label}: origin port`, w);
    const destination = requireText(rate.destination, `${label}: destination port`, w);
    const rateText = cleanText(rate.rateText);
    checkAmountInExcerpt(rateText, rate.excerpt, label, w);

    const rateBasis = normalizeRateBasis(rate.rateBasisText);
    if (rateBasis === null) {
      w.push(
        cleanText(rate.rateBasisText) === null
          ? `${label}: rate basis not stated.`
          : `${label}: unsupported rate basis "${rate.rateBasisText}".`,
      );
    }

    // Rate-specific validity when stated, otherwise the contract-level term.
    const hasOwnFrom = cleanText(rate.validFrom) !== null;
    const hasOwnTo = cleanText(rate.validTo) !== null;
    let validFrom = hasOwnFrom ? validDate(rate.validFrom, `${label}: validity start`, w) : contractFrom;
    let validTo = hasOwnTo ? validDate(rate.validTo, `${label}: validity end`, w) : contractTo;
    if (validFrom && validTo && validFrom > validTo) {
      w.push(`${label}: validity start ${validFrom} is after end ${validTo}; validity left empty.`);
      validFrom = null;
      validTo = null;
    }

    const source = locateExcerpt(doc, rate.excerpt, section);
    if (!source.verified) w.push(`Excerpt for ${label} not found verbatim in ${doc.filename}.`);

    return {
      id,
      contractNumber,
      carrier,
      origin,
      destination,
      route: route(origin, destination),
      containerType: requireText(rate.containerType, `${label}: container type`, w),
      chargeType: normalizeChargeType(chargeLabel),
      chargeLabel,
      unitRateMinor: amountMinor(rateText, `${label}: rate`, w),
      rateBasis,
      currency: resolveCurrency(rate.currency, rateText, currency, label, w),
      validFrom,
      validTo,
      source,
    };
  });
  if (rates.length === 0) w.push(`${where}: no contractual rates extracted.`);

  return { contractNumber, carrier, rates, warnings: [...warnings, ...w] };
}
