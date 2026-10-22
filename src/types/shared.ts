/**
 * Shared contract between the FreightRecover AI engine (Dev 2) and the API layer (Dev 1).
 *
 * Money convention: every `*Minor` field is an integer amount in minor units (cents).
 * The MVP only verifies EUR (2 decimals): EUR 42,500.00 -> 4250000.
 *
 * Missing facts are `null`, never guessed. The audit engine turns missing or
 * ambiguous data into NEEDS_REVIEW instead of producing a discrepancy.
 */

export type DocumentKind = "INVOICE" | "CONTRACT";
export type DocumentFormat = "PDF" | "CSV" | "TEXT";

/** Text of an uploaded document, ready for AI extraction. Produced by `parseDocument`. */
export type ParsedDocument = {
  documentId: string;
  filename: string;
  kind: DocumentKind;
  format: DocumentFormat;
  /** One entry per PDF page; a single entry for CSV and plain text. */
  pages: string[];
  /** All pages joined with blank lines. */
  text: string;
  /** True when `pages` maps to real page numbers (PDF only). */
  pageNumbered: boolean;
  warnings: string[];
};

/** Minimal input accepted by `extractDocuments` when the API already holds the text. */
export type DocumentInput = {
  documentId: string;
  filename: string;
  text: string;
  pages?: string[];
  pageNumbered?: boolean;
};

export type DocumentSource = {
  documentId: string;
  filename: string;
  /** 1-based page, only set when computed from a page-numbered document. Never taken from the model. */
  page?: number;
  /** Section or clause label exactly as written in the document, e.g. "Clause 4.2". */
  section?: string;
  /** Verbatim excerpt from the document. */
  excerpt: string;
  /** True when the excerpt was found verbatim (whitespace-insensitive) in the parsed document text. */
  verified: boolean;
};

export type ChargeType =
  | "OCEAN_FREIGHT"
  | "BAF"
  | "THC_ORIGIN"
  | "THC_DESTINATION"
  | "DOCUMENTATION"
  | "OTHER";

export type RateBasis = "PER_CONTAINER" | "PER_SHIPMENT";

export type InvoiceLine = {
  /** Stable id within the invoice, e.g. "FR-2026-0842#1". */
  id: string;
  lineNumber: number | null;
  description: string;
  /** Normalised by code from `chargeLabel`. */
  chargeType: ChargeType;
  /** Charge label exactly as written on the invoice. */
  chargeLabel: string;
  quantity: number | null;
  unitPriceMinor: number | null;
  amountMinor: number | null;
  currency: string | null;
  source: DocumentSource;
};

export type FreightInvoice = {
  documentId: string;
  filename: string;
  invoiceNumber: string | null;
  carrier: string | null;
  shipmentId: string | null;
  /** ISO dates (YYYY-MM-DD). */
  invoiceDate: string | null;
  /** Date used to check contract validity. */
  shipmentDate: string | null;
  currency: string | null;
  /** Ports as written on the document; the matcher normalises them. */
  origin: string | null;
  destination: string | null;
  /** Display only, e.g. "Shanghai → Rotterdam". */
  route: string | null;
  containerType: string | null;
  totalMinor: number | null;
  lines: InvoiceLine[];
};

export type ContractRate = {
  /** Stable id, e.g. "AOL-SVC-2026-017#4.2.1". */
  id: string;
  contractNumber: string | null;
  carrier: string | null;
  origin: string | null;
  destination: string | null;
  route: string | null;
  containerType: string | null;
  chargeType: ChargeType;
  chargeLabel: string;
  unitRateMinor: number | null;
  rateBasis: RateBasis | null;
  currency: string | null;
  validFrom: string | null;
  validTo: string | null;
  source: DocumentSource;
};

export type ExtractedData = {
  invoice: FreightInvoice;
  rates: ContractRate[];
  warnings: string[];
  meta: {
    /** "FIXTURE" data must never be presented as a live AI extraction. */
    method: "AI" | "FIXTURE";
    model?: string;
    extractedAt: string;
  };
};

export type ReviewReasonCode =
  | "MISSING_DATA"
  | "INVALID_AMOUNT"
  | "UNSUPPORTED_CURRENCY"
  | "CURRENCY_MISMATCH"
  | "CARRIER_MISMATCH"
  | "ROUTE_MISMATCH"
  | "CONTAINER_MISMATCH"
  | "DATE_OUT_OF_VALIDITY"
  | "NO_APPLICABLE_RATE"
  | "AMBIGUOUS_RATE"
  | "UNSUPPORTED_RATE_BASIS"
  | "MISSING_EVIDENCE";

export type ReviewReason = {
  code: ReviewReasonCode;
  message: string;
};

export type MatchCriterion = {
  criterion: "CARRIER" | "ROUTE" | "CONTAINER" | "CHARGE_TYPE" | "DATE" | "CURRENCY";
  invoiceValue: string;
  contractValue: string;
};

export type VerifiedDiscrepancy = {
  /** Deterministic id: `${invoiceLineId}:RATE_MISMATCH`. */
  id: string;
  type: "RATE_MISMATCH";
  status: "VERIFIED";
  invoiceNumber: string;
  shipmentId: string;
  carrier: string;
  invoiceLineId: string;
  contractRateId: string;
  currency: string;
  quantity: number;
  unitRateMinor: number;
  billedAmountMinor: number;
  expectedAmountMinor: number;
  differenceMinor: number;
  /** Human-readable exact calculation, e.g. "EUR 42,500.00 − (EUR 24,000.00 × 1) = EUR 18,500.00". */
  calculation: string;
  matchCriteria: MatchCriterion[];
  invoiceEvidence: DocumentSource;
  contractEvidence: DocumentSource;
  explanation: string;
};

export type LineAuditResult = {
  invoiceLineId: string;
  outcome: "OVERCHARGE" | "NO_DISCREPANCY" | "NEEDS_REVIEW";
  matchedRateId: string | null;
  billedAmountMinor: number | null;
  expectedAmountMinor: number | null;
  /** Signed billed − expected; null when not computable. */
  differenceMinor: number | null;
  reasons: ReviewReason[];
};

export type AuditResult = {
  status: "COMPLETED" | "NEEDS_REVIEW";
  discrepancies: VerifiedDiscrepancy[];
  lineResults: LineAuditResult[];
  /** Flattened review reasons (line-level and invoice-level). */
  reviewItems: Array<ReviewReason & { invoiceLineId: string | null }>;
  warnings: string[];
  totals: {
    currency: string | null;
    /** Sum of verified overcharges only. */
    verifiedOverchargeMinor: number;
  };
};

export type RecoveryClaim = {
  discrepancyId: string;
  subject: string;
  body: string;
  status: "DRAFT";
  requiresHumanApproval: true;
  disputedAmountMinor: number;
  currency: string;
  invoiceNumber: string;
  shipmentId: string;
  evidence: DocumentSource[];
  /** "TEMPLATE" = deterministic fallback built from verified facts when AI generation is unavailable or rejected. */
  generatedBy: "AI" | "TEMPLATE";
  model?: string;
  generatedAt: string;
  warnings: string[];
};
