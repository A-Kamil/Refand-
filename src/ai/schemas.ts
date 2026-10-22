import { z } from "zod";

/**
 * Zod schemas for the RAW output of the Document Analyst (one AI call per document).
 *
 * These schemas are also sent to the API as structured-output constraints, so they stay
 * within the supported subset: objects, strings, numbers, arrays and nullable values.
 * Every key is required; facts the document does not state are `null`.
 * No refinements here (regex, min/max, int): amounts, dates, quantities and currencies are
 * checked by business validation in `services/extraction.ts`, never trusted as returned.
 */

const nullableText = z.string().nullable();

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export const InvoiceLineExtractionSchema = z.object({
  /** Line number as printed on the invoice, null if not numbered. */
  lineNumber: z.number().nullable(),
  description: z.string(),
  /** Charge label exactly as written, e.g. "Ocean Freight". */
  chargeLabel: z.string(),
  quantity: z.number().nullable(),
  /** Unit price exactly as printed, e.g. "EUR 42,500.00". */
  unitPriceText: nullableText,
  /** Line amount exactly as printed, e.g. "EUR 42,500.00". */
  amountText: nullableText,
  currency: nullableText,
  /** Verbatim line from the document, including the amount. */
  excerpt: z.string(),
});

export const InvoiceExtractionSchema = z.object({
  invoiceNumber: nullableText,
  carrier: nullableText,
  shipmentId: nullableText,
  /** YYYY-MM-DD only when a full date is stated. */
  invoiceDate: nullableText,
  shipmentDate: nullableText,
  currency: nullableText,
  /** Ports exactly as written, e.g. "Shanghai (CNSHA)". */
  origin: nullableText,
  destination: nullableText,
  containerType: nullableText,
  /** Invoice total exactly as printed. */
  invoiceTotalText: nullableText,
  lines: z.array(InvoiceLineExtractionSchema),
  /** Missing or unclear facts noticed by the model. */
  warnings: z.array(z.string()),
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
export type InvoiceLineExtraction = z.infer<typeof InvoiceLineExtractionSchema>;

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export const ContractRateExtractionSchema = z.object({
  /** Section number exactly as written, e.g. "4.2.1". */
  section: nullableText,
  chargeLabel: z.string(),
  origin: nullableText,
  destination: nullableText,
  containerType: nullableText,
  /** Rate amount exactly as printed, e.g. "EUR 24,000.00". */
  rateText: nullableText,
  /** Rate basis as written, e.g. "per container". */
  rateBasisText: nullableText,
  currency: nullableText,
  /** Rate-specific validity if stated for this rate, else null. */
  validFrom: nullableText,
  validTo: nullableText,
  /** Verbatim line from the document, including the rate. */
  excerpt: z.string(),
});

export const ContractExtractionSchema = z.object({
  contractNumber: nullableText,
  carrier: nullableText,
  currency: nullableText,
  /** Contract-level validity (YYYY-MM-DD). */
  validFrom: nullableText,
  validTo: nullableText,
  rates: z.array(ContractRateExtractionSchema),
  warnings: z.array(z.string()),
});

export type ContractExtraction = z.infer<typeof ContractExtractionSchema>;
export type ContractRateExtraction = z.infer<typeof ContractRateExtractionSchema>;
