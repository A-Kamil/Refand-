import type {
  ContractRate,
  DocumentSource,
  FreightInvoice,
  InvoiceLine,
  MatchCriterion,
  RateBasis,
  VerifiedDiscrepancy,
} from "../types/shared.js";
import { collapseWhitespace, formatMinor } from "./normalization.js";

export type LocatableDocument = {
  documentId: string;
  filename: string;
  pages: string[];
  pageNumbered: boolean;
};

/**
 * Builds a DocumentSource for an excerpt the model claims to have copied from `doc`.
 * The page number is computed here from the parsed text, never taken from the model.
 * `verified` is true only if the excerpt occurs verbatim (whitespace-insensitive) in the document.
 */
export function locateExcerpt(doc: LocatableDocument, excerpt: string, section?: string | null): DocumentSource {
  const needle = collapseWhitespace(excerpt);
  const source: DocumentSource = {
    documentId: doc.documentId,
    filename: doc.filename,
    excerpt,
    verified: false,
  };
  if (section) source.section = section;
  if (needle.length === 0) return source;

  for (let i = 0; i < doc.pages.length; i++) {
    if (collapseWhitespace(doc.pages[i] ?? "").includes(needle)) {
      source.verified = true;
      if (doc.pageNumbered) source.page = i + 1;
      return source;
    }
  }
  // Excerpt spanning a page break.
  if (collapseWhitespace(doc.pages.join(" ")).includes(needle)) source.verified = true;
  return source;
}

// ---------------------------------------------------------------------------
// Discrepancy builders (deterministic text, used by the audit engine)
// ---------------------------------------------------------------------------

export type CalculationInput = {
  currency: string;
  billedAmountMinor: number;
  unitRateMinor: number;
  quantity: number;
  rateBasis: RateBasis;
  differenceMinor: number;
};

/** "EUR 42,500.00 − (EUR 24,000.00 × 1) = EUR 18,500.00"; per shipment: "EUR 42,500.00 − EUR 24,000.00 = EUR 18,500.00". */
export function buildCalculation(input: CalculationInput): string {
  const billed = formatMinor(input.billedAmountMinor, input.currency);
  const rate = formatMinor(input.unitRateMinor, input.currency);
  const diff = formatMinor(input.differenceMinor, input.currency);
  const expected = input.rateBasis === "PER_CONTAINER" ? `(${rate} × ${input.quantity})` : rate;
  return `${billed} − ${expected} = ${diff}`;
}

export type ExplanationInput = CalculationInput & {
  invoiceNumber: string;
  chargeLabel: string;
  rate: ContractRate;
};

/** Deterministic, fact-only explanation of a verified rate mismatch. */
export function buildExplanation(input: ExplanationInput): string {
  const { rate } = input;
  const billed = formatMinor(input.billedAmountMinor, input.currency);
  const unit = formatMinor(input.unitRateMinor, input.currency);
  const diff = formatMinor(input.differenceMinor, input.currency);
  const basis = input.rateBasis === "PER_CONTAINER" ? `per container × ${input.quantity}` : "per shipment";
  const section = rate.source.section?.trim().replace(/^clause\s+/iu, "");
  const reference = section ? `clause ${section}` : `rate ${rate.id}`;
  const context = [reference, `${rate.origin ?? ""} → ${rate.destination ?? ""}`, rate.containerType ?? ""]
    .filter((part) => part.length > 0)
    .join(", ");
  return (
    `The invoiced ${input.chargeLabel} charge of ${billed} on invoice ${input.invoiceNumber} ` +
    `exceeds the contractual rate of ${unit} ${basis} (${context}) by ${diff}.`
  );
}

export type DiscrepancyInput = {
  invoice: FreightInvoice & { invoiceNumber: string; shipmentId: string; carrier: string };
  line: InvoiceLine;
  rate: ContractRate;
  currency: string;
  quantity: number;
  unitRateMinor: number;
  rateBasis: RateBasis;
  billedAmountMinor: number;
  expectedAmountMinor: number;
  differenceMinor: number;
  matchCriteria: MatchCriterion[];
};

export function buildDiscrepancy(input: DiscrepancyInput): VerifiedDiscrepancy {
  const { invoice, line, rate } = input;
  const calc: CalculationInput = {
    currency: input.currency,
    billedAmountMinor: input.billedAmountMinor,
    unitRateMinor: input.unitRateMinor,
    quantity: input.quantity,
    rateBasis: input.rateBasis,
    differenceMinor: input.differenceMinor,
  };
  return {
    id: `${line.id}:RATE_MISMATCH`,
    type: "RATE_MISMATCH",
    status: "VERIFIED",
    invoiceNumber: invoice.invoiceNumber,
    shipmentId: invoice.shipmentId,
    carrier: invoice.carrier,
    invoiceLineId: line.id,
    contractRateId: rate.id,
    currency: input.currency,
    quantity: input.quantity,
    unitRateMinor: input.unitRateMinor,
    billedAmountMinor: input.billedAmountMinor,
    expectedAmountMinor: input.expectedAmountMinor,
    differenceMinor: input.differenceMinor,
    calculation: buildCalculation(calc),
    matchCriteria: input.matchCriteria,
    invoiceEvidence: { ...line.source },
    contractEvidence: { ...rate.source },
    explanation: buildExplanation({ ...calc, invoiceNumber: invoice.invoiceNumber, chargeLabel: line.chargeLabel, rate }),
  };
}
