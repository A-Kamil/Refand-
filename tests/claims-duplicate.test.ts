import { describe, expect, it } from "vitest";
import type { LlmCaller } from "../src/ai/client.js";
import { EngineError } from "../src/errors.js";
import { assertClaimable, buildTemplateClaim, generateClaim, validateClaimText } from "../src/services/claims.js";
import type { DuplicateChargeDiscrepancy, RateMismatchDiscrepancy, VerifiedDiscrepancy } from "../src/types/shared.js";

const EXCERPT = "1 | Ocean Freight | Shanghai (CNSHA) to Rotterdam (NLRTM) | 40HC | 1 | EUR 42,500.00 | EUR 42,500.00";

function duplicate(overrides: Partial<DuplicateChargeDiscrepancy> = {}): DuplicateChargeDiscrepancy {
  return {
    id: "FR-2026-0907#1:DUPLICATE_CHARGE",
    type: "DUPLICATE_CHARGE",
    status: "VERIFIED",
    invoiceNumber: "FR-2026-0907",
    shipmentId: "SHIP-00421",
    carrier: "Atlantic Ocean Lines",
    invoiceLineId: "FR-2026-0907#1",
    currency: "EUR",
    quantity: 1,
    billedAmountMinor: 4250000,
    expectedAmountMinor: 0,
    differenceMinor: 4250000,
    calculation: "EUR 42,500.00 billed again − EUR 0.00 due (already billed on invoice FR-2026-0842, line FR-2026-0842#1) = EUR 42,500.00",
    duplicateCriteria: [],
    invoiceEvidence: { documentId: "d2", filename: "invoice-duplicate-sample.pdf", page: 1, excerpt: EXCERPT, verified: true },
    original: {
      analysisId: "an-1",
      documentId: "d1",
      filename: "invoice-sample.pdf",
      invoiceNumber: "FR-2026-0842",
      invoiceDate: "2026-10-20",
      invoiceLineId: "FR-2026-0842#1",
    },
    originalEvidence: { documentId: "d1", filename: "invoice-sample.pdf", page: 1, excerpt: EXCERPT, verified: true },
    explanation: "The Ocean Freight charge of EUR 42,500.00 on invoice FR-2026-0907 was already billed on invoice FR-2026-0842.",
    ...overrides,
  };
}

const letter = (body: string) =>
  JSON.stringify({ subject: "Duplicate billing — FR-2026-0907 (SHIP-00421)", body });

const GOOD_BODY =
  "Dear Billing Team,\n\nInvoice FR-2026-0907 for shipment SHIP-00421 bills an Ocean Freight charge of EUR 42,500.00 " +
  "that was already billed on invoice FR-2026-0842 dated 2026-10-20. We kindly request cancellation of the duplicated " +
  "charge and a credit note for EUR 42,500.00, or reimbursement if it has already been paid.\n\nKind regards,\nFreight Audit Team";

const fakeLlm = (...bodies: string[]): LlmCaller & { calls: string[] } => {
  const calls: string[] = [];
  const fn = (async (request) => {
    calls.push(typeof request.content === "string" ? request.content : JSON.stringify(request.content));
    const body = bodies[Math.min(calls.length - 1, bodies.length - 1)]!;
    return { raw: letter(body), model: "fake-model" };
  }) as LlmCaller & { calls: string[] };
  fn.calls = calls;
  return fn;
};

describe("duplicate charge claims", () => {
  it("AI letter: draft, exact amount, both invoices as evidence, payload carries the original invoice", async () => {
    const llm = fakeLlm(GOOD_BODY);
    const claim = await generateClaim(duplicate(), { llm });
    expect(claim).toMatchObject({
      discrepancyId: "FR-2026-0907#1:DUPLICATE_CHARGE",
      status: "DRAFT",
      requiresHumanApproval: true,
      generatedBy: "AI",
      disputedAmountMinor: 4250000,
      currency: "EUR",
      invoiceNumber: "FR-2026-0907",
    });
    expect(claim.evidence.map((e) => e.filename)).toEqual(["invoice-duplicate-sample.pdf", "invoice-sample.pdf"]);
    expect(llm.calls[0]).toContain('"type": "DUPLICATE_CHARGE"');
    expect(llm.calls[0]).toContain('"invoiceNumber": "FR-2026-0842"');
    expect(llm.calls[0]).toContain("<verified_discrepancy>");
  });

  it("letter without the original invoice number is retried, then replaced by the template", async () => {
    const missing = GOOD_BODY.replace("invoice FR-2026-0842 dated 2026-10-20", "an earlier invoice");
    const llm = fakeLlm(missing, missing);
    const claim = await generateClaim(duplicate(), { llm });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]).toContain("original invoice number FR-2026-0842");
    expect(claim.generatedBy).toBe("TEMPLATE");
    expect(claim.body).toContain("FR-2026-0842");
  });

  it("a contractual amount is not allowed in a duplicate letter", () => {
    const problems = validateClaimText("s", `${GOOD_BODY}\nThe contractual rate is EUR 24,000.00.`, duplicate());
    expect(problems.join(" ")).toContain('"EUR 24,000.00" is not one of the verified amounts');
  });

  it("template is exact, neutral and passes its own validation", () => {
    const { subject, body } = buildTemplateClaim(duplicate());
    expect(subject).toBe("Duplicate Billing — Invoice FR-2026-0907 (Shipment SHIP-00421)");
    expect(body).toContain("EUR 42,500.00");
    expect(body).toContain("FR-2026-0842 dated 2026-10-20");
    expect(body).toContain(EXCERPT);
    expect(body).not.toMatch(/recovered|legal action|court|lawsuit/iu);
    expect(validateClaimText(subject, body, duplicate())).toEqual([]);
  });

  it.each([
    ["expected not 0", { expectedAmountMinor: 100 as unknown as 0 }],
    ["difference differs from billed", { differenceMinor: 1850000 }],
    ["original is the same invoice", { original: { ...duplicate().original, invoiceNumber: "fr 2026-0907" } }],
    ["original evidence unverified", { originalEvidence: { ...duplicate().originalEvidence, verified: false } }],
  ])("refuses a tampered duplicate: %s", (_name, overrides) => {
    expect(() => assertClaimable(duplicate(overrides as Partial<DuplicateChargeDiscrepancy>))).toThrow(EngineError);
  });

  it("refuses a rate mismatch superseded by a duplicate (no double claim)", async () => {
    const superseded: RateMismatchDiscrepancy = {
      id: "FR-2026-0907#1:RATE_MISMATCH",
      type: "RATE_MISMATCH",
      status: "VERIFIED",
      invoiceNumber: "FR-2026-0907",
      shipmentId: "SHIP-00421",
      carrier: "Atlantic Ocean Lines",
      invoiceLineId: "FR-2026-0907#1",
      contractRateId: "AOL-SVC-2026-017#4.2.1",
      currency: "EUR",
      quantity: 1,
      unitRateMinor: 2400000,
      billedAmountMinor: 4250000,
      expectedAmountMinor: 2400000,
      differenceMinor: 1850000,
      calculation: "EUR 42,500.00 − (EUR 24,000.00 × 1) = EUR 18,500.00",
      matchCriteria: [],
      invoiceEvidence: duplicate().invoiceEvidence,
      contractEvidence: { documentId: "c", filename: "contract-sample.pdf", page: 2, section: "4.2.1", excerpt: "x", verified: true },
      explanation: "x",
      supersededBy: "FR-2026-0907#1:DUPLICATE_CHARGE",
    };
    await expect(generateClaim(superseded, { llm: fakeLlm(GOOD_BODY) })).rejects.toMatchObject({ code: "CLAIM_NOT_ALLOWED" });
  });

  it("refuses an unknown finding type", () => {
    expect(() => assertClaimable({ ...duplicate(), type: "OTHER" } as unknown as VerifiedDiscrepancy)).toThrow(/CLAIM|verified/u);
  });
});

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("live duplicate claim (real AI)", () => {
  it("drafts a validated AI letter for the exact duplicated amount", async () => {
    const claim = await generateClaim(duplicate(), { allowTemplateFallback: false });
    expect(claim.generatedBy).toBe("AI");
    expect(claim.disputedAmountMinor).toBe(4250000);
    expect(claim.body).toContain("FR-2026-0842");
    expect(validateClaimText(claim.subject, claim.body, duplicate())).toEqual([]);
  }, 120_000);
});
