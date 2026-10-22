import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditInvoice } from "../src/services/audit.js";
import { calculateOvercharge, findApplicableRate, matchRate } from "../src/services/contract-matcher.js";
import type { AuditResult, ContractRate, ExtractedData, FreightInvoice, InvoiceLine } from "../src/types/shared.js";

// ---------------------------------------------------------------------------
// Builders mirroring the demo case (FR-2026-0842 vs AOL-SVC-2026-017)
// ---------------------------------------------------------------------------

const INVOICE_EXCERPT = "1 | Ocean Freight | Shanghai (CNSHA) to Rotterdam (NLRTM) | 40HC | 1 | EUR 42,500.00 | EUR 42,500.00";
const RATE_EXCERPT = "4.2.1 Ocean Freight | Shanghai (CNSHA) to Rotterdam (NLRTM) | 40HC | EUR 24,000.00 per container";

function makeLine(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: "FR-2026-0842#1",
    lineNumber: 1,
    description: "Ocean Freight",
    chargeType: "OCEAN_FREIGHT",
    chargeLabel: "Ocean Freight",
    quantity: 1,
    unitPriceMinor: 4250000,
    amountMinor: 4250000,
    currency: "EUR",
    source: {
      documentId: "doc-invoice",
      filename: "invoice-sample.pdf",
      page: 1,
      excerpt: INVOICE_EXCERPT,
      verified: true,
    },
    ...overrides,
  };
}

function makeRate(clause: string, overrides: Partial<ContractRate> = {}): ContractRate {
  return {
    id: `AOL-SVC-2026-017#${clause}`,
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
      section: clause,
      excerpt: `${clause} Ocean Freight | ...`,
      verified: true,
    },
    ...overrides,
  };
}

function demoRates(): ContractRate[] {
  return [
    makeRate("4.2.1", { source: { documentId: "doc-contract", filename: "contract-sample.pdf", page: 2, section: "4.2.1", excerpt: RATE_EXCERPT, verified: true } }),
    makeRate("4.2.2", { destination: "Hamburg (DEHAM)", route: "Shanghai → Hamburg", unitRateMinor: 2550000 }),
    makeRate("4.2.3", { containerType: "20GP", unitRateMinor: 1400000 }),
  ];
}

function makeData(
  opts: { invoice?: Partial<FreightInvoice>; line?: Partial<InvoiceLine>; lines?: InvoiceLine[]; rates?: ContractRate[] } = {},
): ExtractedData {
  const lines = opts.lines ?? [makeLine(opts.line)];
  return {
    invoice: {
      documentId: "doc-invoice",
      filename: "invoice-sample.pdf",
      invoiceNumber: "FR-2026-0842",
      carrier: "Atlantic Ocean Lines",
      shipmentId: "SHIP-00421",
      invoiceDate: "2026-10-20",
      shipmentDate: "2026-10-15",
      currency: "EUR",
      origin: "Shanghai (CNSHA)",
      destination: "Rotterdam (NLRTM)",
      route: "Shanghai → Rotterdam",
      containerType: "40HC",
      totalMinor: lines.reduce((s, l) => s + (l.amountMinor ?? 0), 0),
      lines,
      ...opts.invoice,
    },
    rates: opts.rates ?? demoRates(),
    warnings: [],
    meta: { method: "FIXTURE", extractedAt: "2026-10-22T00:00:00.000Z" },
  };
}

const codes = (r: AuditResult): string[] => r.reviewItems.map((i) => i.code);

// ---------------------------------------------------------------------------

describe("auditInvoice — demo case", () => {
  it("finds the exact EUR 18,500.00 overcharge with evidence", () => {
    const r = auditInvoice(makeData());
    expect(r.status).toBe("COMPLETED");
    expect(r.reviewItems).toEqual([]);
    expect(r.totals).toEqual({ currency: "EUR", verifiedOverchargeMinor: 1850000 });
    expect(r.discrepancies).toHaveLength(1);
    const d = r.discrepancies[0]!;
    expect(d).toMatchObject({
      id: "FR-2026-0842#1:RATE_MISMATCH",
      type: "RATE_MISMATCH",
      status: "VERIFIED",
      invoiceNumber: "FR-2026-0842",
      shipmentId: "SHIP-00421",
      carrier: "Atlantic Ocean Lines",
      invoiceLineId: "FR-2026-0842#1",
      contractRateId: "AOL-SVC-2026-017#4.2.1",
      currency: "EUR",
      quantity: 1,
      unitRateMinor: 2400000,
      billedAmountMinor: 4250000,
      expectedAmountMinor: 2400000,
      differenceMinor: 1850000,
    });
    expect(d.calculation).toBe("EUR 42,500.00 − (EUR 24,000.00 × 1) = EUR 18,500.00");
    expect(d.explanation).toBe(
      "The invoiced Ocean Freight charge of EUR 42,500.00 on invoice FR-2026-0842 exceeds the contractual rate of " +
        "EUR 24,000.00 per container × 1 (clause 4.2.1, Shanghai (CNSHA) → Rotterdam (NLRTM), 40HC) by EUR 18,500.00.",
    );
    expect(d.invoiceEvidence.excerpt).toBe(INVOICE_EXCERPT);
    expect(d.contractEvidence).toMatchObject({ excerpt: RATE_EXCERPT, page: 2, section: "4.2.1", verified: true });
    expect(d.matchCriteria.map((c) => c.criterion)).toEqual(["CHARGE_TYPE", "CARRIER", "ROUTE", "CONTAINER", "DATE", "CURRENCY"]);
    expect(d.matchCriteria.find((c) => c.criterion === "ROUTE")).toEqual({
      criterion: "ROUTE",
      invoiceValue: "Shanghai (CNSHA) → Rotterdam (NLRTM)",
      contractValue: "Shanghai (CNSHA) → Rotterdam (NLRTM)",
    });
    expect(d.matchCriteria.find((c) => c.criterion === "DATE")).toEqual({
      criterion: "DATE",
      invoiceValue: "2026-10-15",
      contractValue: "2026-01-01 to 2026-12-31",
    });
    expect(r.lineResults[0]).toMatchObject({ outcome: "OVERCHARGE", matchedRateId: "AOL-SVC-2026-017#4.2.1", differenceMinor: 1850000 });
  });

  it("equal amounts → no discrepancy, COMPLETED", () => {
    const r = auditInvoice(makeData({ line: { amountMinor: 2400000, unitPriceMinor: 2400000 } }));
    expect(r.status).toBe("COMPLETED");
    expect(r.discrepancies).toEqual([]);
    expect(r.lineResults[0]).toMatchObject({ outcome: "NO_DISCREPANCY", differenceMinor: 0 });
    expect(r.totals.verifiedOverchargeMinor).toBe(0);
  });

  it("undercharge is not a discrepancy", () => {
    const r = auditInvoice(makeData({ line: { amountMinor: 2000000 } }));
    expect(r.status).toBe("COMPLETED");
    expect(r.discrepancies).toEqual([]);
    expect(r.lineResults[0]).toMatchObject({ outcome: "NO_DISCREPANCY", differenceMinor: -400000, expectedAmountMinor: 2400000 });
  });

  it("quantity 2 × rate", () => {
    const r = auditInvoice(makeData({ line: { quantity: 2, amountMinor: 5000000 } }));
    const d = r.discrepancies[0]!;
    expect(d.expectedAmountMinor).toBe(4800000);
    expect(d.differenceMinor).toBe(200000);
    expect(d.calculation).toBe("EUR 50,000.00 − (EUR 24,000.00 × 2) = EUR 2,000.00");
  });

  it("PER_SHIPMENT basis ignores quantity", () => {
    const rates = [makeRate("4.2.1", { rateBasis: "PER_SHIPMENT" })];
    const r = auditInvoice(makeData({ line: { quantity: 3, amountMinor: 3000000 }, rates }));
    const d = r.discrepancies[0]!;
    expect(d.expectedAmountMinor).toBe(2400000);
    expect(d.differenceMinor).toBe(600000);
    expect(d.calculation).toBe("EUR 30,000.00 − EUR 24,000.00 = EUR 6,000.00");
    expect(d.explanation).toContain("EUR 24,000.00 per shipment");
  });

  it("null rate basis → UNSUPPORTED_RATE_BASIS", () => {
    const r = auditInvoice(makeData({ rates: [makeRate("4.2.1", { rateBasis: null })] }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(codes(r)).toEqual(["UNSUPPORTED_RATE_BASIS"]);
  });
});

describe("auditInvoice — matching review cases", () => {
  it("route mismatch → NEEDS_REVIEW ROUTE_MISMATCH with quoted values", () => {
    const rates = demoRates().filter((rate) => !rate.id.endsWith("4.2.2"));
    const r = auditInvoice(makeData({ invoice: { destination: "Hamburg (DEHAM)" }, rates }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.discrepancies).toEqual([]);
    expect(codes(r)).toEqual(["ROUTE_MISMATCH"]);
    expect(r.reviewItems[0]!.message).toContain("Invoice route CNSHA → DEHAM does not match contract route CNSHA → NLRTM");
    expect(r.reviewItems[0]!.invoiceLineId).toBe("FR-2026-0842#1");
  });

  it("Shanghai → Antwerp invoice matches nothing", () => {
    const r = auditInvoice(makeData({ invoice: { destination: "Antwerp" } }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(new Set(codes(r))).toEqual(new Set(["ROUTE_MISMATCH"]));
  });

  it("shipment date outside validity → DATE_OUT_OF_VALIDITY", () => {
    const r = auditInvoice(makeData({ invoice: { shipmentDate: "2027-02-01" } }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(codes(r)).toEqual(["DATE_OUT_OF_VALIDITY"]);
    expect(r.reviewItems[0]!.message).toContain("2027-02-01");
  });

  it("USD invoice → UNSUPPORTED_CURRENCY", () => {
    const r = auditInvoice(makeData({ invoice: { currency: "USD" }, line: { currency: "USD" } }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(codes(r)).toEqual(["UNSUPPORTED_CURRENCY"]);
    expect(r.discrepancies).toEqual([]);
  });

  it("EUR invoice vs USD-only rate → CURRENCY_MISMATCH", () => {
    const r = auditInvoice(makeData({ rates: [makeRate("4.2.1", { currency: "USD" })] }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(codes(r)).toEqual(["CURRENCY_MISMATCH"]);
  });

  it("two contradictory matching rates → AMBIGUOUS_RATE", () => {
    const rates = [...demoRates(), makeRate("9.9", { unitRateMinor: 2300000 })];
    const r = auditInvoice(makeData({ rates }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(codes(r)).toEqual(["AMBIGUOUS_RATE"]);
    expect(r.reviewItems[0]!.message).toContain("AOL-SVC-2026-017#4.2.1");
    expect(r.reviewItems[0]!.message).toContain("AOL-SVC-2026-017#9.9");
  });

  it("identical duplicate rates → still matched", () => {
    const rates = [...demoRates(), makeRate("9.9")];
    const r = auditInvoice(makeData({ rates }));
    expect(r.status).toBe("COMPLETED");
    expect(r.discrepancies[0]!.contractRateId).toBe("AOL-SVC-2026-017#4.2.1");
    expect(r.totals.verifiedOverchargeMinor).toBe(1850000);
  });

  it("unverified rate evidence → MISSING_EVIDENCE, no discrepancy", () => {
    const rates = demoRates();
    rates[0]!.source.verified = false;
    const r = auditInvoice(makeData({ rates }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.discrepancies).toEqual([]);
    expect(codes(r)).toEqual(["MISSING_EVIDENCE"]);
    expect(r.totals.verifiedOverchargeMinor).toBe(0);
  });

  it("empty invoice excerpt → MISSING_EVIDENCE", () => {
    const r = auditInvoice(makeData({ line: { source: { documentId: "d", filename: "f", excerpt: "  ", verified: true } } }));
    expect(codes(r)).toEqual(["MISSING_EVIDENCE"]);
  });

  it("missing containerType → MISSING_DATA", () => {
    const r = auditInvoice(makeData({ invoice: { containerType: null } }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(codes(r)).toEqual(["MISSING_DATA"]);
    expect(r.reviewItems[0]!.message).toContain("containerType");
  });

  it("missing shipmentDate → MISSING_DATA, never falls back to invoiceDate", () => {
    const r = auditInvoice(makeData({ invoice: { shipmentDate: null, invoiceDate: "2026-10-20" } }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(codes(r)).toEqual(["MISSING_DATA"]);
    expect(r.reviewItems[0]!.message).toContain("shipmentDate");
    expect(r.discrepancies).toEqual([]);
  });

  it("missing shipmentId → overcharge not verified", () => {
    const r = auditInvoice(makeData({ invoice: { shipmentId: null } }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(codes(r)).toEqual(["MISSING_DATA"]);
    expect(r.discrepancies).toEqual([]);
  });

  it("null / invalid amounts → review", () => {
    expect(codes(auditInvoice(makeData({ line: { amountMinor: null } })))).toEqual(["MISSING_DATA"]);
    expect(codes(auditInvoice(makeData({ line: { amountMinor: 12.5 } })))).toEqual(["INVALID_AMOUNT"]);
    expect(codes(auditInvoice(makeData({ line: { quantity: null } })))).toEqual(["MISSING_DATA"]);
    expect(codes(auditInvoice(makeData({ line: { quantity: 0 } })))).toEqual(["INVALID_AMOUNT"]);
  });

  it("no lines → NEEDS_REVIEW invoice-level item", () => {
    const r = auditInvoice(makeData({ lines: [] }));
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.reviewItems).toEqual([expect.objectContaining({ code: "MISSING_DATA", invoiceLineId: null })]);
  });

  it("no rate for the charge type → NO_APPLICABLE_RATE", () => {
    const r = auditInvoice(makeData({ line: { chargeType: "BAF", chargeLabel: "BAF" } }));
    expect(codes(r)).toEqual(["NO_APPLICABLE_RATE"]);
  });

  it("line totals ≠ invoice total → warning only", () => {
    const r = auditInvoice(makeData({ invoice: { totalMinor: 9999999 } }));
    expect(r.status).toBe("COMPLETED");
    expect(r.warnings.some((w) => w.includes("does not equal invoice total"))).toBe(true);
  });
});

describe("matchRate", () => {
  it("20GP line matches 4.2.3, not 4.2.1", () => {
    const data = makeData({ invoice: { containerType: "20GP" } });
    const rate = findApplicableRate(data.invoice, data.invoice.lines[0]!, data.rates);
    expect(rate?.id).toBe("AOL-SVC-2026-017#4.2.3");
  });

  it("alias 40' High Cube matches 40HC", () => {
    const data = makeData({ invoice: { containerType: "40' High Cube" } });
    const m = matchRate(data.invoice, data.invoice.lines[0]!, data.rates);
    expect(m.outcome).toBe("MATCHED");
    if (m.outcome === "MATCHED") {
      expect(m.rate.id).toBe("AOL-SVC-2026-017#4.2.1");
      expect(m.criteria.find((c) => c.criterion === "CONTAINER")).toEqual({
        criterion: "CONTAINER",
        invoiceValue: "40' High Cube",
        contractValue: "40HC",
      });
    }
  });

  it("unclassified charges are never matched, even against an OTHER rate", () => {
    const data = makeData({
      line: { chargeType: "OTHER", chargeLabel: "Mystery fee" },
      rates: [makeRate("9.9", { chargeType: "OTHER", chargeLabel: "Special fee" })],
    });
    const m = matchRate(data.invoice, data.invoice.lines[0]!, data.rates);
    expect(m.outcome === "NEEDS_REVIEW" && m.reasons.map((r) => r.code)).toEqual(["NO_APPLICABLE_RATE"]);
  });

  it("carrier with legal suffix matches; other carrier does not", () => {
    const ok = makeData({ invoice: { carrier: "ATLANTIC OCEAN LINES LTD." } });
    expect(findApplicableRate(ok.invoice, ok.invoice.lines[0]!, ok.rates)?.id).toBe("AOL-SVC-2026-017#4.2.1");
    const ko = makeData({ invoice: { carrier: "Pacific Lines" } });
    const m = matchRate(ko.invoice, ko.invoice.lines[0]!, ko.rates);
    expect(m.outcome === "NEEDS_REVIEW" && m.reasons.map((r) => r.code)).toEqual(["CARRIER_MISMATCH"]);
  });
});

describe("calculateOvercharge", () => {
  it("computes exact integer difference", () => {
    expect(calculateOvercharge(4250000, 2400000, 1)).toEqual({
      billedAmountMinor: 4250000,
      expectedAmountMinor: 2400000,
      differenceMinor: 1850000,
      signedDifferenceMinor: 1850000,
      isOvercharged: true,
    });
    expect(calculateOvercharge(2000000, 2400000, 1)).toMatchObject({ differenceMinor: 0, isOvercharged: false });
  });

  it("throws on invalid inputs", () => {
    expect(() => calculateOvercharge(1.5, 100, 1)).toThrow();
    expect(() => calculateOvercharge(-1, 100, 1)).toThrow();
    expect(() => calculateOvercharge(100, -1, 1)).toThrow();
    expect(() => calculateOvercharge(100, 100, 0)).toThrow();
    expect(() => calculateOvercharge(100, 100, -2)).toThrow();
    expect(() => calculateOvercharge(100, 100, 1.5)).toThrow();
    expect(() => calculateOvercharge(Number.NaN, 100, 1)).toThrow();
    expect(() => calculateOvercharge(100, Number.MAX_SAFE_INTEGER, 2)).toThrow();
  });
});

// ---------------------------------------------------------------------------

const extractedSample = fileURLToPath(new URL("../fixtures/extracted-sample.json", import.meta.url));
const expectedAudit = fileURLToPath(new URL("../fixtures/expected-audit.json", import.meta.url));

describe("fixtures", () => {
  it.skipIf(!existsSync(extractedSample))("extracted-sample.json audits to expected-audit.json", () => {
    const data = JSON.parse(readFileSync(extractedSample, "utf8")) as ExtractedData;
    const expected = JSON.parse(readFileSync(expectedAudit, "utf8")) as {
      status: AuditResult["status"];
      totals: AuditResult["totals"];
      discrepancies: Array<Record<string, unknown> & { invoiceEvidenceExcerpt: string; contractEvidenceExcerpt: string }>;
    };
    const r = auditInvoice(data);
    expect(r.status).toBe(expected.status);
    expect(r.totals).toEqual(expected.totals);
    expect(r.discrepancies).toHaveLength(expected.discrepancies.length);
    expected.discrepancies.forEach((exp, i) => {
      const { invoiceEvidenceExcerpt, contractEvidenceExcerpt, ...fields } = exp;
      const d = r.discrepancies[i]!;
      expect(d).toMatchObject(fields);
      expect(d.invoiceEvidence.excerpt).toBe(invoiceEvidenceExcerpt);
      expect(d.contractEvidence.excerpt).toBe(contractEvidenceExcerpt);
    });
  });
});
