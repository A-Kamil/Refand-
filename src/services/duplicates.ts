import type {
  AuditResult,
  DocumentSource,
  DuplicateChargeDiscrepancy,
  DuplicateCriterion,
  FreightInvoice,
  InvoiceHistoryEntry,
  InvoiceLine,
  ReviewReason,
} from "../types/shared.js";
import {
  formatMinor,
  isIsoDate,
  normalizeCarrier,
  normalizeContainerType,
  normalizeCurrency,
  normalizePort,
  normalizeReference,
} from "./normalization.js";

/**
 * Deterministic duplicate-billing detection against previously analysed invoices.
 *
 * - Same file (SHA-256) or same document id: a re-analysis, never a duplicate.
 * - Same carrier + same invoice number, different file: NEEDS_REVIEW (re-issue or re-submission; payment unknown).
 * - Different invoice number, same carrier + shipment, and a line identical on charge type, route, container,
 *   quantity, amount and currency: VERIFIED DUPLICATE_CHARGE, only if the original is ACTIVE, the current invoice
 *   is strictly later, both lines have verified evidence, and each original line is used at most once.
 * - Same carrier + shipment + charge type with any difference: NEEDS_REVIEW (correction or extra containers).
 */

export type DuplicateCheckOptions = {
  /** Excluded from the history (the analysis being run). */
  currentAnalysisId?: string;
};

export type DuplicateCheckResult = {
  discrepancies: DuplicateChargeDiscrepancy[];
  reviewItems: Array<ReviewReason & { invoiceLineId: string | null }>;
  duplicateCheck: AuditResult["duplicateCheck"];
};

type InvoiceKeys = {
  carrier: string | null;
  invoiceNumber: string | null;
  shipmentId: string | null;
  origin: string | null;
  destination: string | null;
  container: string | null;
  currency: string | null;
};

type Candidate = { entry: InvoiceHistoryEntry; line: InvoiceLine };

export function detectDuplicates(
  invoice: FreightInvoice,
  history: InvoiceHistoryEntry[],
  options: DuplicateCheckOptions = {},
): DuplicateCheckResult {
  const discrepancies: DuplicateChargeDiscrepancy[] = [];
  const reviewItems: DuplicateCheckResult["reviewItems"] = [];
  const notes: string[] = [];
  const sameDocumentAnalysisIds: string[] = [];

  const others: InvoiceHistoryEntry[] = [];
  for (const entry of history) {
    if (options.currentAnalysisId && entry.analysisId === options.currentAnalysisId) continue;
    const sameHash = !!invoice.contentHash && entry.invoice.contentHash === invoice.contentHash;
    if (sameHash || entry.invoice.documentId === invoice.documentId) {
      sameDocumentAnalysisIds.push(entry.analysisId);
      notes.push(`The same file was already analysed in analysis ${entry.analysisId}; re-analysis is not a duplicate.`);
      continue;
    }
    others.push(entry);
  }

  const result = (): DuplicateCheckResult => ({
    discrepancies,
    reviewItems,
    duplicateCheck: { performed: true, historyChecked: others.length, sameDocumentAnalysisIds, notes },
  });
  if (others.length === 0) return result();

  const current = keysOf(invoice);
  if (!current.carrier) {
    reviewItems.push({
      code: "MISSING_DATA",
      message: "Duplicate check incomplete: the invoice carrier is missing",
      invoiceLineId: null,
    });
    return result();
  }

  const sameCarrier = others.filter((e) => keysOf(e.invoice).carrier === current.carrier);
  const lineHistory: InvoiceHistoryEntry[] = [];

  // 1. Same invoice number from the same carrier, different file.
  for (const entry of sameCarrier) {
    const other = keysOf(entry.invoice);
    if (current.invoiceNumber && other.invoiceNumber === current.invoiceNumber) {
      const ref = describeInvoice(entry);
      if (entry.status !== "ACTIVE") {
        notes.push(`Invoice number ${invoice.invoiceNumber} was previously received as ${ref}, which is ${entry.status}; a re-issue is expected.`);
      } else {
        const identical = sameInvoiceContent(invoice, entry.invoice);
        reviewItems.push({
          code: "DUPLICATE_INVOICE_NUMBER",
          message:
            `Invoice number ${invoice.invoiceNumber} from ${invoice.carrier} was already received as ${ref}` +
            (identical ? " with identical content" : ` with different content (${contentDifference(invoice, entry.invoice)})`) +
            ". Check it was not paid twice before approving.",
          invoiceLineId: null,
        });
      }
      continue;
    }
    if (current.shipmentId && other.shipmentId === current.shipmentId) lineHistory.push(entry);
  }

  // 2. Same shipment, different invoice number: compare lines.
  const consumed = new Set<string>();
  for (const line of invoice.lines) {
    if (line.chargeType === "OTHER") continue;
    const candidates: Candidate[] = [];
    for (const entry of lineHistory) {
      for (const other of entry.invoice.lines) {
        if (other.chargeType === line.chargeType) candidates.push({ entry, line: other });
      }
    }
    if (candidates.length === 0) continue;

    const reasons: ReviewReason[] = [];
    const verifiable: Candidate[] = [];
    for (const c of candidates) {
      if (c.entry.status !== "ACTIVE") {
        notes.push(`Line ${line.id}: same charge on ${describeInvoice(c.entry)}, which is ${c.entry.status}; not a duplicate.`);
        continue;
      }
      const outcome = classify(invoice, current, line, c, reasons);
      if (outcome === "VERIFIABLE") verifiable.push(c);
    }

    verifiable.sort(
      (a, b) =>
        (a.entry.invoice.invoiceDate ?? "").localeCompare(b.entry.invoice.invoiceDate ?? "") ||
        a.entry.analysisId.localeCompare(b.entry.analysisId),
    );
    const original = verifiable.find((c) => !consumed.has(candidateKey(c)));
    if (original) {
      consumed.add(candidateKey(original));
      discrepancies.push(buildDuplicate(invoice, line, original));
      continue;
    }
    if (verifiable.length > 0) {
      notes.push(`Line ${line.id}: identical charges on earlier invoices are already matched to other lines of this invoice.`);
    }
    const seen = new Set<string>();
    for (const r of reasons) {
      if (seen.has(r.message)) continue;
      seen.add(r.message);
      reviewItems.push({ ...r, invoiceLineId: line.id });
    }
  }

  return result();
}

/** Decides whether a same-charge candidate is a verifiable duplicate; otherwise records why it needs review. */
function classify(
  invoice: FreightInvoice,
  current: InvoiceKeys,
  line: InvoiceLine,
  c: Candidate,
  reasons: ReviewReason[],
): "VERIFIABLE" | "NOT_VERIFIABLE" {
  const ref = `${describeInvoice(c.entry)} line ${c.line.id}`;
  const label = `${line.chargeLabel} for shipment ${invoice.shipmentId}`;

  const differences = compareLines(current, line, keysOf(c.entry.invoice), c.line);
  if (differences.length > 0) {
    reasons.push({
      code: "POSSIBLE_DUPLICATE",
      message: `${label} is also billed on ${ref}, with differences (${differences.join("; ")}): possibly a corrected invoice or additional containers.`,
    });
    return "NOT_VERIFIABLE";
  }

  const currentDate = invoice.invoiceDate;
  const originalDate = c.entry.invoice.invoiceDate;
  if (!isIsoDate(currentDate) || !isIsoDate(originalDate) || currentDate === originalDate) {
    reasons.push({
      code: "POSSIBLE_DUPLICATE",
      message: `${label} is billed identically on ${ref}, but invoice dates (${currentDate ?? "missing"} vs ${originalDate ?? "missing"}) do not show which invoice is the duplicate.`,
    });
    return "NOT_VERIFIABLE";
  }
  if (currentDate < originalDate) {
    reasons.push({
      code: "POSSIBLE_DUPLICATE",
      message: `${label} is billed identically on the later ${ref}; the duplicate is that later invoice, not this one.`,
    });
    return "NOT_VERIFIABLE";
  }

  if (!hasVerifiedEvidence(line.source) || !hasVerifiedEvidence(c.line.source)) {
    reasons.push({
      code: "POSSIBLE_DUPLICATE",
      message: `${label} matches ${ref}, but the evidence on one of the invoices is not verified.`,
    });
    return "NOT_VERIFIABLE";
  }
  if (!invoice.invoiceNumber || !invoice.shipmentId || !invoice.carrier || !c.entry.invoice.invoiceNumber) {
    reasons.push({ code: "MISSING_DATA", message: `${label} matches ${ref}, but invoice references are incomplete.` });
    return "NOT_VERIFIABLE";
  }
  return "VERIFIABLE";
}

/** Human-readable differences between two same-charge lines; empty when identical on every criterion. */
function compareLines(current: InvoiceKeys, line: InvoiceLine, original: InvoiceKeys, other: InvoiceLine): string[] {
  const diffs: string[] = [];
  const cmp = (name: string, a: string | number | null, b: string | number | null, show = (v: string | number) => String(v)) => {
    if (a === null || b === null) diffs.push(`${name} missing`);
    else if (a !== b) diffs.push(`${name} ${show(a)} vs ${show(b)}`);
  };
  const cur = lineCurrency(line, current);
  cmp("route", route(current), route(original));
  cmp("container", current.container, original.container);
  cmp("quantity", validQuantity(line.quantity), validQuantity(other.quantity));
  cmp("currency", cur, lineCurrency(other, original));
  cmp("amount", validAmount(line.amountMinor), validAmount(other.amountMinor), (v) => formatMinor(Number(v), cur ?? ""));
  return diffs;
}

function buildDuplicate(invoice: FreightInvoice, line: InvoiceLine, original: Candidate): DuplicateChargeDiscrepancy {
  const orig = original.entry.invoice;
  const current = keysOf(invoice);
  const currency = lineCurrency(line, current) as string;
  const amount = line.amountMinor as number;
  const quantity = line.quantity as number;
  const display = formatMinor(amount, currency);
  const invoiceNumber = invoice.invoiceNumber as string;
  const originalNumber = orig.invoiceNumber as string;
  const originalDate = orig.invoiceDate as string;
  const s = (v: string | null) => v ?? "";

  const duplicateCriteria: DuplicateCriterion[] = [
    { criterion: "CARRIER", currentValue: s(invoice.carrier), originalValue: s(orig.carrier) },
    { criterion: "SHIPMENT", currentValue: s(invoice.shipmentId), originalValue: s(orig.shipmentId) },
    {
      criterion: "CHARGE_TYPE",
      currentValue: `${line.chargeLabel} (${line.chargeType})`,
      originalValue: `${original.line.chargeLabel} (${original.line.chargeType})`,
    },
    {
      criterion: "ROUTE",
      currentValue: `${s(invoice.origin)} → ${s(invoice.destination)}`,
      originalValue: `${s(orig.origin)} → ${s(orig.destination)}`,
    },
    { criterion: "CONTAINER", currentValue: s(invoice.containerType), originalValue: s(orig.containerType) },
    { criterion: "QUANTITY", currentValue: String(quantity), originalValue: String(original.line.quantity) },
    { criterion: "AMOUNT", currentValue: display, originalValue: formatMinor(original.line.amountMinor as number, currency) },
    { criterion: "CURRENCY", currentValue: currency, originalValue: currency },
  ];

  return {
    id: `${line.id}:DUPLICATE_CHARGE`,
    type: "DUPLICATE_CHARGE",
    status: "VERIFIED",
    invoiceNumber,
    shipmentId: invoice.shipmentId as string,
    carrier: invoice.carrier as string,
    invoiceLineId: line.id,
    currency,
    quantity,
    billedAmountMinor: amount,
    expectedAmountMinor: 0,
    differenceMinor: amount,
    calculation: `${display} billed again − ${formatMinor(0, currency)} due (already billed on invoice ${originalNumber}, line ${original.line.id}) = ${display}`,
    duplicateCriteria,
    invoiceEvidence: { ...line.source },
    original: {
      analysisId: original.entry.analysisId,
      documentId: orig.documentId,
      filename: orig.filename,
      invoiceNumber: originalNumber,
      invoiceDate: originalDate,
      invoiceLineId: original.line.id,
    },
    originalEvidence: { ...original.line.source },
    explanation:
      `The ${line.chargeLabel} charge of ${display} (${quantity} × ${s(invoice.containerType)}, ${s(invoice.origin)} → ${s(invoice.destination)}) ` +
      `on invoice ${invoiceNumber} for shipment ${invoice.shipmentId} was already billed on invoice ${originalNumber} dated ${originalDate} ` +
      `(line ${original.line.id}). The full duplicated amount of ${display} is disputed.`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function keysOf(invoice: FreightInvoice): InvoiceKeys {
  return {
    carrier: normalizeCarrier(invoice.carrier),
    invoiceNumber: normalizeReference(invoice.invoiceNumber),
    shipmentId: normalizeReference(invoice.shipmentId),
    origin: normalizePort(invoice.origin),
    destination: normalizePort(invoice.destination),
    container: normalizeContainerType(invoice.containerType),
    currency: normalizeCurrency(invoice.currency),
  };
}

function route(keys: InvoiceKeys): string | null {
  return keys.origin && keys.destination ? `${keys.origin} → ${keys.destination}` : null;
}

function lineCurrency(line: InvoiceLine, keys: InvoiceKeys): string | null {
  return normalizeCurrency(line.currency) ?? keys.currency;
}

function validAmount(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function validQuantity(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function hasVerifiedEvidence(source: DocumentSource | undefined): boolean {
  return !!source && source.verified === true && source.excerpt.trim().length > 0;
}

function candidateKey(c: Candidate): string {
  return `${c.entry.analysisId}|${c.line.id}`;
}

function describeInvoice(entry: InvoiceHistoryEntry): string {
  const inv = entry.invoice;
  return `invoice ${inv.invoiceNumber ?? "(no number)"}${inv.invoiceDate ? ` dated ${inv.invoiceDate}` : ""} (analysis ${entry.analysisId}, ${inv.filename})`;
}

function sameInvoiceContent(a: FreightInvoice, b: FreightInvoice): boolean {
  return contentDifference(a, b) === "";
}

function contentDifference(a: FreightInvoice, b: FreightInvoice): string {
  const diffs: string[] = [];
  const cur = normalizeCurrency(a.currency) ?? "";
  if (a.totalMinor !== b.totalMinor) {
    const show = (v: number | null) => (v === null ? "missing" : formatMinor(v, cur));
    diffs.push(`total ${show(a.totalMinor)} vs ${show(b.totalMinor)}`);
  }
  if (normalizeReference(a.shipmentId) !== normalizeReference(b.shipmentId)) {
    diffs.push(`shipment ${a.shipmentId ?? "missing"} vs ${b.shipmentId ?? "missing"}`);
  }
  if (a.lines.length !== b.lines.length) diffs.push(`${a.lines.length} vs ${b.lines.length} lines`);
  return diffs.join("; ");
}
