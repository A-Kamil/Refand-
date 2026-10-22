import { describe, expect, it } from "vitest";
import { auditInvoice } from "../src/services/audit.js";
import { detectDuplicates } from "../src/services/duplicates.js";
import type {
  ContractRate,
  DuplicateChargeDiscrepancy,
  ExtractedData,
  FreightInvoice,
  InvoiceHistoryEntry,
  InvoiceLine,
  RateMismatchDiscrepancy,
} from "../src/types/shared.js";

const EXCERPT = "1 | Ocean Freight | Shanghai (CNSHA) to Rotterdam (NLRTM) | 40HC | 1 | EUR 42,500.00 | EUR 42,500.00";

function line(invoiceNumber: string, overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: `${invoiceNumber}#1`,
    lineNumber: 1,
    description: "Ocean Freight",
    chargeType: "OCEAN_FREIGHT",
    chargeLabel: "Ocean Freight",
    quantity: 1,
    unitPriceMinor: 4250000,
    amountMinor: 4250000,
    currency: "EUR",
    source: { documentId: `doc-${invoiceNumber}`, filename: `${invoiceNumber}.pdf`, page: 1, excerpt: EXCERPT, verified: true },
    ...overrides,
  };
}

function invoice(invoiceNumber: string, invoiceDate: string | null, overrides: Partial<FreightInvoice> = {}): FreightInvoice {
  return {
    documentId: `doc-${invoiceNumber}`,
    filename: `${invoiceNumber}.pdf`,
    contentHash: `hash-${invoiceNumber}`,
    invoiceNumber,
    carrier: "Atlantic Ocean Lines",
    shipmentId: "SHIP-00421",
    invoiceDate,
    shipmentDate: "2026-10-15",
    currency: "EUR",
    origin: "Shanghai (CNSHA)",
    destination: "Rotterdam (NLRTM)",
    route: "Shanghai → Rotterdam",
    containerType: "40HC",
    totalMinor: 4250000,
    lines: [line(invoiceNumber)],
    ...overrides,
  };
}

const entry = (analysisId: string, inv: FreightInvoice, status: InvoiceHistoryEntry["status"] = "ACTIVE"): InvoiceHistoryEntry => ({
  analysisId,
  status,
  invoice: inv,
});

const original = (overrides: Partial<FreightInvoice> = {}) => invoice("FR-2026-0842", "2026-10-20", overrides);
const current = (overrides: Partial<FreightInvoice> = {}) => invoice("FR-2026-0907", "2026-11-05", overrides);
const codes = (r: { reviewItems: Array<{ code: string }> }) => r.reviewItems.map((i) => i.code);

describe("detectDuplicates — verified duplicate charge", () => {
  it("flags the identical charge billed again on a later invoice", () => {
    const r = detectDuplicates(current(), [entry("an-1", original())]);
    expect(r.reviewItems).toEqual([]);
    expect(r.discrepancies).toHaveLength(1);
    const d = r.discrepancies[0]!;
    expect(d).toMatchObject({
      id: "FR-2026-0907#1:DUPLICATE_CHARGE",
      type: "DUPLICATE_CHARGE",
      status: "VERIFIED",
      invoiceNumber: "FR-2026-0907",
      shipmentId: "SHIP-00421",
      carrier: "Atlantic Ocean Lines",
      currency: "EUR",
      quantity: 1,
      billedAmountMinor: 4250000,
      expectedAmountMinor: 0,
      differenceMinor: 4250000,
      original: {
        analysisId: "an-1",
        documentId: "doc-FR-2026-0842",
        invoiceNumber: "FR-2026-0842",
        invoiceDate: "2026-10-20",
        invoiceLineId: "FR-2026-0842#1",
      },
    });
    expect(d.duplicateCriteria.map((c) => c.criterion)).toEqual([
      "CARRIER", "SHIPMENT", "CHARGE_TYPE", "ROUTE", "CONTAINER", "QUANTITY", "AMOUNT", "CURRENCY",
    ]);
    expect(d.calculation).toBe(
      "EUR 42,500.00 billed again − EUR 0.00 due (already billed on invoice FR-2026-0842, line FR-2026-0842#1) = EUR 42,500.00",
    );
    expect(d.invoiceEvidence.verified && d.originalEvidence.verified).toBe(true);
    expect(d.explanation).toContain("already billed on invoice FR-2026-0842 dated 2026-10-20");
  });

  it("matches through explicit normalisations (carrier suffix, LOCODE, container alias, reference formatting)", () => {
    const cur = current({
      carrier: "ATLANTIC OCEAN LINES LTD.",
      shipmentId: "ship 00421",
      origin: "Shanghai",
      destination: "Port of Rotterdam",
      containerType: "40' High Cube",
    });
    expect(detectDuplicates(cur, [entry("an-1", original())]).discrepancies).toHaveLength(1);
  });

  it("uses each original line once and picks the earliest original", () => {
    const twoLines = current({ lines: [line("FR-2026-0907"), line("FR-2026-0907", { id: "FR-2026-0907#2", lineNumber: 2 })], totalMinor: 8500000 });
    const one = detectDuplicates(twoLines, [entry("an-1", original())]);
    expect(one.discrepancies).toHaveLength(1);
    expect(one.discrepancies[0]!.invoiceLineId).toBe("FR-2026-0907#1");

    const later = invoice("FR-2026-0850", "2026-10-28");
    const r = detectDuplicates(current(), [entry("an-2", later), entry("an-1", original())]);
    expect(r.discrepancies).toHaveLength(1);
    expect(r.discrepancies[0]!.original.invoiceNumber).toBe("FR-2026-0842");
  });
});

describe("detectDuplicates — never a duplicate", () => {
  it("re-analysis of the same file (same SHA-256) is not a duplicate", () => {
    const r = detectDuplicates(original(), [entry("an-1", original({ documentId: "other-upload" }))]);
    expect(r.discrepancies).toEqual([]);
    expect(r.reviewItems).toEqual([]);
    expect(r.duplicateCheck).toMatchObject({ performed: true, historyChecked: 0, sameDocumentAnalysisIds: ["an-1"] });
  });

  it("same document id is not a duplicate; the current analysis is excluded", () => {
    expect(detectDuplicates(original(), [entry("an-1", original({ contentHash: null }))]).discrepancies).toEqual([]);
    const r = detectDuplicates(current(), [entry("an-current", original())], { currentAnalysisId: "an-current" });
    expect(r.discrepancies).toEqual([]);
    expect(r.duplicateCheck.historyChecked).toBe(0);
  });

  it.each(["CREDITED", "CANCELLED"] as const)("an original that is %s is not duplicated", (status) => {
    const r = detectDuplicates(current(), [entry("an-1", original(), status)]);
    expect(r.discrepancies).toEqual([]);
    expect(r.reviewItems).toEqual([]);
    expect(r.duplicateCheck.notes.join(" ")).toContain(status);
  });

  it("different shipment or different carrier: unrelated", () => {
    expect(detectDuplicates(current({ shipmentId: "SHIP-00999" }), [entry("an-1", original())])).toMatchObject({ discrepancies: [], reviewItems: [] });
    const otherCarrier = original({ carrier: "Pacific Ocean Lines" });
    expect(detectDuplicates(current(), [entry("an-1", otherCarrier)])).toMatchObject({ discrepancies: [], reviewItems: [] });
    // Same invoice number from another carrier is a different invoice.
    const sameNumber = invoice("FR-2026-0907", "2026-10-01", { carrier: "Pacific Ocean Lines", contentHash: "x", documentId: "y" });
    expect(detectDuplicates(current(), [entry("an-1", sameNumber)])).toMatchObject({ discrepancies: [], reviewItems: [] });
  });

  it("unclassified charges (OTHER) are never compared", () => {
    const other = (n: string) => line(n, { chargeType: "OTHER", chargeLabel: "Misc" });
    const r = detectDuplicates(current({ lines: [other("FR-2026-0907")] }), [entry("an-1", original({ lines: [other("FR-2026-0842")] }))]);
    expect(r).toMatchObject({ discrepancies: [], reviewItems: [] });
  });

  it("empty history: checked, nothing found", () => {
    expect(detectDuplicates(current(), []).duplicateCheck).toMatchObject({ performed: true, historyChecked: 0 });
  });
});

describe("detectDuplicates — needs review, never verified", () => {
  it("same invoice number from the same carrier in another file", () => {
    const resent = original({ documentId: "doc-resent", contentHash: "hash-resent", filename: "resent.pdf" });
    const r = detectDuplicates(resent, [entry("an-1", original())]);
    expect(r.discrepancies).toEqual([]);
    expect(codes(r)).toEqual(["DUPLICATE_INVOICE_NUMBER"]);
    expect(r.reviewItems[0]!.message).toContain("identical content");

    const different = original({ invoiceNumber: "fr 2026 0842", documentId: "d2", contentHash: "h2", totalMinor: 2400000 });
    const r2 = detectDuplicates(different, [entry("an-1", original())]);
    expect(codes(r2)).toEqual(["DUPLICATE_INVOICE_NUMBER"]);
    expect(r2.reviewItems[0]!.message).toContain("total EUR 24,000.00 vs EUR 42,500.00");
  });

  it("same invoice number but the original was credited: note only", () => {
    const resent = original({ documentId: "doc-resent", contentHash: "hash-resent" });
    const r = detectDuplicates(resent, [entry("an-1", original(), "CREDITED")]);
    expect(r.reviewItems).toEqual([]);
    expect(r.duplicateCheck.notes.join(" ")).toContain("re-issue");
  });

  it.each([
    ["amount", { lines: [line("FR-2026-0907", { amountMinor: 2400000 })] }, "amount EUR 24,000.00 vs EUR 42,500.00"],
    ["quantity", { lines: [line("FR-2026-0907", { quantity: 2 })] }, "quantity 2 vs 1"],
    ["container", { containerType: "20GP" }, "container 20GP vs 40HC"],
    ["route", { destination: "Hamburg (DEHAM)" }, "route CNSHA → DEHAM vs CNSHA → NLRTM"],
  ] as const)("partial match on %s", (_name, overrides, detail) => {
    const r = detectDuplicates(current(overrides as Partial<FreightInvoice>), [entry("an-1", original())]);
    expect(r.discrepancies).toEqual([]);
    expect(codes(r)).toEqual(["POSSIBLE_DUPLICATE"]);
    expect(r.reviewItems[0]!.message).toContain(detail);
  });

  it("the current invoice is the earlier one", () => {
    const r = detectDuplicates(invoice("FR-2026-0800", "2026-10-01"), [entry("an-1", original())]);
    expect(r.discrepancies).toEqual([]);
    expect(r.reviewItems[0]!.message).toContain("the duplicate is that later invoice");
  });

  it.each([
    ["same date", "2026-10-20"],
    ["missing date", null],
  ])("cannot order the invoices: %s", (_name, date) => {
    const r = detectDuplicates(current({ invoiceDate: date }), [entry("an-1", original())]);
    expect(r.discrepancies).toEqual([]);
    expect(codes(r)).toEqual(["POSSIBLE_DUPLICATE"]);
  });

  it("unverified evidence on either invoice", () => {
    const unverified = line("FR-2026-0907", { source: { ...line("FR-2026-0907").source, verified: false } });
    const r = detectDuplicates(current({ lines: [unverified] }), [entry("an-1", original())]);
    expect(r.discrepancies).toEqual([]);
    expect(r.reviewItems[0]!.message).toContain("not verified");
  });

  it("missing carrier on the current invoice", () => {
    const r = detectDuplicates(current({ carrier: null }), [entry("an-1", original())]);
    expect(codes(r)).toEqual(["MISSING_DATA"]);
  });
});

// ---------------------------------------------------------------------------
// Integration with auditInvoice
// ---------------------------------------------------------------------------

const RATE: ContractRate = {
  id: "AOL-SVC-2026-017#4.2.1",
  contractNumber: "AOL-SVC-2026-017",
  carrier: "Atlantic Ocean Lines",
  origin: "Shanghai (CNSHA)",
  destination: "Rotterdam (NLRTM)",
  route: "Shanghai → Rotterdam",
  containerType: "40HC",
  chargeType: "OCEAN_FREIGHT",
  chargeLabel: "Ocean Freight",
  unitRateMinor: 2400000,
  rateBasis: "PER_CONTAINER",
  currency: "EUR",
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  source: {
    documentId: "doc-contract",
    filename: "contract-sample.pdf",
    page: 2,
    section: "4.2.1",
    excerpt: "4.2.1 Ocean Freight | Shanghai (CNSHA) to Rotterdam (NLRTM) | 40HC | EUR 24,000.00 per container",
    verified: true,
  },
};

const data = (inv: FreightInvoice): ExtractedData => ({
  invoice: inv,
  rates: [RATE],
  warnings: [],
  meta: { method: "FIXTURE", extractedAt: "2026-11-05T00:00:00.000Z" },
});

describe("auditInvoice with history", () => {
  it("without history: duplicates not checked, rate mismatch only", () => {
    const r = auditInvoice(data(current()));
    expect(r.duplicateCheck.performed).toBe(false);
    expect(r.discrepancies.map((d) => d.type)).toEqual(["RATE_MISMATCH"]);
    expect(r.totals.verifiedOverchargeMinor).toBe(1850000);
  });

  it("duplicate supersedes the rate mismatch on the same line: no double counting", () => {
    const r = auditInvoice(data(current()), { history: [entry("an-1", original())] });
    expect(r.status).toBe("COMPLETED");
    const rate = r.discrepancies.find((d): d is RateMismatchDiscrepancy => d.type === "RATE_MISMATCH")!;
    const dup = r.discrepancies.find((d): d is DuplicateChargeDiscrepancy => d.type === "DUPLICATE_CHARGE")!;
    expect(rate.differenceMinor).toBe(1850000);
    expect(rate.supersededBy).toBe(dup.id);
    expect(dup.differenceMinor).toBe(4250000);
    expect(r.totals.verifiedOverchargeMinor).toBe(4250000);
    expect(r.lineResults[0]).toMatchObject({ outcome: "OVERCHARGE", duplicateDiscrepancyId: dup.id });
  });

  it("re-analysing the demo invoice with itself in history stays COMPLETED with EUR 18,500.00", () => {
    const r = auditInvoice(data(original()), { history: [entry("an-1", original())] });
    expect(r.status).toBe("COMPLETED");
    expect(r.discrepancies.map((d) => d.type)).toEqual(["RATE_MISMATCH"]);
    expect(r.totals.verifiedOverchargeMinor).toBe(1850000);
    expect(r.duplicateCheck.sameDocumentAnalysisIds).toEqual(["an-1"]);
  });

  it("possible duplicate turns a clean line into NEEDS_REVIEW", () => {
    const clean = (n: string, d: string) => invoice(n, d, { lines: [line(n, { amountMinor: 2400000 })], totalMinor: 2400000 });
    const r = auditInvoice(data(clean("FR-2026-0907", "2026-11-05")), {
      history: [entry("an-1", original())],
    });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.lineResults[0]!.outcome).toBe("NEEDS_REVIEW");
    expect(codes(r)).toEqual(["POSSIBLE_DUPLICATE"]);
    expect(r.totals.verifiedOverchargeMinor).toBe(0);
  });
});
