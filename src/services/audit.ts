import type {
  AuditResult,
  DocumentSource,
  ExtractedData,
  FreightInvoice,
  InvoiceLine,
  LineAuditResult,
  ReviewReason,
  VerifiedDiscrepancy,
} from "../types/shared.js";
import { calculateOvercharge, matchRate } from "./contract-matcher.js";
import { buildDiscrepancy } from "./evidence.js";
import { formatMinor, normalizeCurrency } from "./normalization.js";

/**
 * Deterministic invoice audit. Pure and synchronous; no AI, no FX conversion.
 * Bad or incomplete business data never throws: it produces NEEDS_REVIEW items.
 * A discrepancy is VERIFIED only when the rate match is unambiguous, the math is exact
 * and both the invoice line and the contract rate are backed by verified excerpts.
 */

/** The MVP only verifies EUR. */
const SUPPORTED_CURRENCY = "EUR";

type LineOutcome = { result: LineAuditResult; discrepancy: VerifiedDiscrepancy | null };

export function auditInvoice(data: ExtractedData): AuditResult {
  const { invoice, rates } = data;
  const warnings = [...data.warnings];
  const reviewItems: AuditResult["reviewItems"] = [];
  const lineResults: LineAuditResult[] = [];
  const discrepancies: VerifiedDiscrepancy[] = [];

  if (invoice.lines.length === 0) {
    reviewItems.push({ code: "MISSING_DATA", message: "Invoice has no charge lines to audit", invoiceLineId: null });
  }

  for (const line of invoice.lines) {
    const { result, discrepancy } = auditLine(invoice, line, data);
    lineResults.push(result);
    for (const reason of result.reasons) reviewItems.push({ ...reason, invoiceLineId: line.id });
    if (discrepancy) discrepancies.push(discrepancy);
  }

  const totalsWarning = checkLineTotals(invoice);
  if (totalsWarning) warnings.push(totalsWarning);
  if (rates.length === 0) warnings.push("No contract rates were extracted");

  const currency =
    normalizeCurrency(invoice.currency) ?? normalizeCurrency(invoice.lines.find((l) => l.currency)?.currency) ?? null;

  return {
    status: reviewItems.length > 0 ? "NEEDS_REVIEW" : "COMPLETED",
    discrepancies,
    lineResults,
    reviewItems,
    warnings,
    totals: {
      currency,
      verifiedOverchargeMinor: discrepancies.reduce((sum, d) => sum + d.differenceMinor, 0),
    },
  };
}

function auditLine(invoice: FreightInvoice, line: InvoiceLine, data: ExtractedData): LineOutcome {
  const result: LineAuditResult = {
    invoiceLineId: line.id,
    outcome: "NEEDS_REVIEW",
    matchedRateId: null,
    billedAmountMinor: isValidMinor(line.amountMinor) ? line.amountMinor : null,
    expectedAmountMinor: null,
    differenceMinor: null,
    reasons: [],
  };
  const review = (...reasons: ReviewReason[]): LineOutcome => {
    result.outcome = "NEEDS_REVIEW";
    result.reasons.push(...reasons);
    return { result, discrepancy: null };
  };

  // 1. Currency: EUR only, line and invoice must agree.
  const lineCurrency = normalizeCurrency(line.currency);
  const invoiceCurrency = normalizeCurrency(invoice.currency);
  if (lineCurrency && invoiceCurrency && lineCurrency !== invoiceCurrency) {
    return review({
      code: "CURRENCY_MISMATCH",
      message: `Line currency ${lineCurrency} differs from invoice currency ${invoiceCurrency}`,
    });
  }
  const currency = lineCurrency ?? invoiceCurrency;
  if (!currency) return review({ code: "MISSING_DATA", message: "Line and invoice currency are missing" });
  if (currency !== SUPPORTED_CURRENCY) {
    return review({
      code: "UNSUPPORTED_CURRENCY",
      message: `Currency ${currency} is not supported; only ${SUPPORTED_CURRENCY} invoices are verified (no FX conversion)`,
    });
  }

  // 2. Billed amount + rate match (reported together).
  const pre: ReviewReason[] = [];
  if (line.amountMinor === null) {
    pre.push({ code: "MISSING_DATA", message: "Line amount is missing" });
  } else if (!isValidMinor(line.amountMinor)) {
    pre.push({ code: "INVALID_AMOUNT", message: `Line amount ${line.amountMinor} is not a valid non-negative integer amount` });
  }
  const match = matchRate(invoice, line, data.rates);
  if (match.outcome === "NEEDS_REVIEW") pre.push(...match.reasons);
  if (pre.length > 0 || match.outcome !== "MATCHED") return review(...pre);
  const billed = line.amountMinor as number;
  const { rate, criteria } = match;
  result.matchedRateId = rate.id;

  // 3. Rate value and basis.
  if (rate.unitRateMinor === null) {
    return review({ code: "MISSING_DATA", message: `Contract rate ${rate.id} has no unit rate` });
  }
  if (!isValidMinor(rate.unitRateMinor)) {
    return review({ code: "INVALID_AMOUNT", message: `Contract rate ${rate.id} has an invalid unit rate ${rate.unitRateMinor}` });
  }
  if (rate.rateBasis === null) {
    return review({ code: "UNSUPPORTED_RATE_BASIS", message: `Contract rate ${rate.id} has no recognised rate basis` });
  }
  let quantity = 1;
  if (rate.rateBasis === "PER_CONTAINER") {
    if (line.quantity === null) return review({ code: "MISSING_DATA", message: "Line quantity is missing" });
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      return review({ code: "INVALID_AMOUNT", message: `Line quantity ${line.quantity} is not a positive whole number` });
    }
    quantity = line.quantity;
    if (!Number.isSafeInteger(rate.unitRateMinor * quantity)) {
      return review({ code: "INVALID_AMOUNT", message: "Expected amount is out of range" });
    }
  }

  // 4. Exact integer math.
  const calc = calculateOvercharge(billed, rate.unitRateMinor, quantity);
  result.expectedAmountMinor = calc.expectedAmountMinor;
  result.differenceMinor = calc.signedDifferenceMinor;

  // 5. Evidence gate: no verified excerpt, no conclusion.
  const evidenceReasons: ReviewReason[] = [];
  if (!hasVerifiedEvidence(line.source)) {
    evidenceReasons.push({ code: "MISSING_EVIDENCE", message: `Invoice line ${line.id} is not backed by a verified document excerpt` });
  }
  if (!hasVerifiedEvidence(rate.source)) {
    evidenceReasons.push({ code: "MISSING_EVIDENCE", message: `Contract rate ${rate.id} is not backed by a verified document excerpt` });
  }
  if (evidenceReasons.length > 0) return review(...evidenceReasons);

  if (!calc.isOvercharged) {
    result.outcome = "NO_DISCREPANCY";
    return { result, discrepancy: null };
  }

  // 6. Facts required to state a verified discrepancy.
  const { invoiceNumber, shipmentId, carrier } = invoice;
  if (!invoiceNumber || !shipmentId || !carrier) {
    const missing = [!invoiceNumber && "invoiceNumber", !shipmentId && "shipmentId", !carrier && "carrier"].filter(Boolean);
    return review({
      code: "MISSING_DATA",
      message: `Overcharge of ${formatMinor(calc.differenceMinor, currency)} cannot be verified; invoice is missing: ${missing.join(", ")}`,
    });
  }

  result.outcome = "OVERCHARGE";
  const discrepancy = buildDiscrepancy({
    invoice: { ...invoice, invoiceNumber, shipmentId, carrier },
    line,
    rate,
    currency,
    quantity,
    unitRateMinor: rate.unitRateMinor,
    rateBasis: rate.rateBasis,
    billedAmountMinor: calc.billedAmountMinor,
    expectedAmountMinor: calc.expectedAmountMinor,
    differenceMinor: calc.differenceMinor,
    matchCriteria: criteria,
  });
  return { result, discrepancy };
}

function isValidMinor(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function hasVerifiedEvidence(source: DocumentSource | null | undefined): boolean {
  return !!source && source.verified === true && typeof source.excerpt === "string" && source.excerpt.trim().length > 0;
}

function checkLineTotals(invoice: FreightInvoice): string | null {
  if (invoice.totalMinor === null || invoice.lines.length === 0) return null;
  const amounts = invoice.lines.map((l) => l.amountMinor);
  if (amounts.some((a) => !isValidMinor(a))) return null;
  const sum = (amounts as number[]).reduce((s, a) => s + a, 0);
  if (sum === invoice.totalMinor) return null;
  const cur = normalizeCurrency(invoice.currency) ?? "";
  const fmt = (m: number): string => (cur ? formatMinor(m, cur) : String(m));
  return `Sum of invoice lines (${fmt(sum)}) does not equal invoice total (${fmt(invoice.totalMinor)})`;
}
