import { describe, expect, it } from "vitest";
import type { LlmCaller, StructuredRequest } from "../src/ai/client.js";
import { EngineError } from "../src/errors.js";
import {
  buildTemplateClaim,
  generateClaim,
  renderClaimAsText,
  validateClaimText,
} from "../src/services/claims.js";
import type { VerifiedDiscrepancy } from "../src/types/shared.js";

const INVOICE_EXCERPT = "1 | Ocean Freight | Shanghai (CNSHA) to Rotterdam (NLRTM) | 40HC | 1 | EUR 42,500.00 | EUR 42,500.00";
const CONTRACT_EXCERPT = "4.2.1 Ocean Freight | Shanghai (CNSHA) to Rotterdam (NLRTM) | 40HC | EUR 24,000.00 per container";

function demoFinding(overrides: Partial<VerifiedDiscrepancy> = {}): VerifiedDiscrepancy {
  return {
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
    calculation: "EUR 42,500.00 − (EUR 24,000.00 × 1) = EUR 18,500.00",
    matchCriteria: [],
    invoiceEvidence: {
      documentId: "inv-1",
      filename: "invoice-sample.pdf",
      page: 1,
      excerpt: INVOICE_EXCERPT,
      verified: true,
    },
    contractEvidence: {
      documentId: "ctr-1",
      filename: "contract-sample.pdf",
      page: 2,
      section: "4.2.1",
      excerpt: CONTRACT_EXCERPT,
      verified: true,
    },
    explanation: "Ocean Freight billed above the contractual rate in clause 4.2.1.",
    ...overrides,
  };
}

const VALID_LETTER = {
  subject: "Billing dispute — invoice FR-2026-0842, shipment SHIP-00421",
  body: [
    "Dear Billing Team,",
    "",
    "Invoice FR-2026-0842 for shipment SHIP-00421 bills Ocean Freight at EUR 42,500.00, while clause 4.2.1 of our contract sets EUR 24,000.00 per container.",
    "The disputed amount is EUR 18,500.00. Invoice evidence: \"" + INVOICE_EXCERPT + "\". Contract evidence: \"" + CONTRACT_EXCERPT + "\".",
    "We kindly request a credit note or reimbursement of €18,500.",
    "",
    "Kind regards,",
    "Freight Audit Team",
  ].join("\n"),
};

const WRONG_AMOUNT_LETTER = {
  subject: VALID_LETTER.subject,
  body: VALID_LETTER.body.replace("The disputed amount is EUR 18,500.00.", "The disputed amount is EUR 19,000.00."),
};

function fakeCaller(outputs: Array<string | Error>): LlmCaller & { requests: StructuredRequest[] } {
  const requests: StructuredRequest[] = [];
  const caller = (async (request: StructuredRequest) => {
    requests.push(request);
    const next = outputs[Math.min(requests.length - 1, outputs.length - 1)];
    if (next instanceof Error) throw next;
    return { raw: next ?? "", model: "fake-model" };
  }) as LlmCaller & { requests: StructuredRequest[] };
  caller.requests = requests;
  return caller;
}

const FORBIDDEN = /legal action|lawsuit|court|litigation|recovered|refunded|\[|\{\{/iu;

describe("generateClaim with AI", () => {
  it("returns an AI DRAFT with the exact verified amount", async () => {
    const llm = fakeCaller([JSON.stringify(VALID_LETTER)]);
    const claim = await generateClaim(demoFinding(), { llm });
    expect(claim.status).toBe("DRAFT");
    expect(claim.requiresHumanApproval).toBe(true);
    expect(claim.generatedBy).toBe("AI");
    expect(claim.model).toBe("fake-model");
    expect(claim.disputedAmountMinor).toBe(1850000);
    expect(claim.currency).toBe("EUR");
    expect(claim.discrepancyId).toBe("FR-2026-0842#1:RATE_MISMATCH");
    expect(claim.body).toContain("EUR 18,500.00");
    expect(claim.evidence.map((e) => e.filename)).toEqual(["invoice-sample.pdf", "contract-sample.pdf"]);
    expect(claim.warnings).toEqual([]);
    expect(llm.requests).toHaveLength(1);
  });

  it("sends only verified facts inside <verified_discrepancy> with display amounts", async () => {
    const llm = fakeCaller([JSON.stringify(VALID_LETTER)]);
    await generateClaim(demoFinding(), { llm });
    const request = llm.requests[0]!;
    expect(request.system).toContain("Recovery Claim Agent");
    const content = String(request.content);
    const match = content.match(/<verified_discrepancy>([\s\S]*)<\/verified_discrepancy>/u);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match![1]!);
    expect(payload.invoiceNumber).toBe("FR-2026-0842");
    expect(payload.shipmentId).toBe("SHIP-00421");
    expect(payload.amounts.billed).toEqual({ minor: 4250000, display: "EUR 42,500.00" });
    expect(payload.amounts.contractualUnitRate.display).toBe("EUR 24,000.00");
    expect(payload.amounts.expected.display).toBe("EUR 24,000.00");
    expect(payload.amounts.disputed).toEqual({ minor: 1850000, display: "EUR 18,500.00" });
    expect(payload.contractEvidence).toMatchObject({ filename: "contract-sample.pdf", page: 2, section: "4.2.1", excerpt: CONTRACT_EXCERPT });
    expect(payload.invoiceEvidence).toMatchObject({ filename: "invoice-sample.pdf", page: 1, excerpt: INVOICE_EXCERPT });
  });

  it("retries once with feedback when the letter has a wrong amount", async () => {
    const llm = fakeCaller([JSON.stringify(WRONG_AMOUNT_LETTER), JSON.stringify(VALID_LETTER)]);
    const claim = await generateClaim(demoFinding(), { llm });
    expect(claim.generatedBy).toBe("AI");
    expect(claim.disputedAmountMinor).toBe(1850000);
    expect(llm.requests).toHaveLength(2);
    expect(String(llm.requests[1]!.content)).toContain("EUR 19,000.00");
    expect(String(llm.requests[1]!.content)).toContain("<validation_feedback>");
    expect(claim.warnings).toHaveLength(1);
  });

  it("falls back to the template when both attempts are invalid", async () => {
    const llm = fakeCaller([JSON.stringify(WRONG_AMOUNT_LETTER)]);
    const claim = await generateClaim(demoFinding(), { llm });
    expect(llm.requests).toHaveLength(2);
    expect(claim.generatedBy).toBe("TEMPLATE");
    expect(claim.model).toBeUndefined();
    expect(claim.disputedAmountMinor).toBe(1850000);
    expect(claim.warnings.join(" ")).toMatch(/rejected by validation/u);
  });

  it("handles invalid JSON from the AI (retry, then fallback)", async () => {
    const recovered = fakeCaller(["not json", JSON.stringify(VALID_LETTER)]);
    expect((await generateClaim(demoFinding(), { llm: recovered })).generatedBy).toBe("AI");

    const broken = fakeCaller(["not json", JSON.stringify({ subject: 1 })]);
    const claim = await generateClaim(demoFinding(), { llm: broken });
    expect(claim.generatedBy).toBe("TEMPLATE");
    expect(broken.requests).toHaveLength(2);
  });

  it("falls back to the template when the AI is unavailable", async () => {
    const llm = fakeCaller([new EngineError("AI_UNAVAILABLE", "no key")]);
    const claim = await generateClaim(demoFinding(), { llm });
    expect(claim.generatedBy).toBe("TEMPLATE");
    expect(claim.warnings).toEqual(["AI claim generation unavailable: AI_UNAVAILABLE; draft built from verified facts template."]);
    expect(llm.requests).toHaveLength(1);
  });

  it("throws when template fallback is disabled", async () => {
    await expect(
      generateClaim(demoFinding(), { llm: fakeCaller([new EngineError("AI_UNAVAILABLE", "no key")]), allowTemplateFallback: false }),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    await expect(
      generateClaim(demoFinding(), { llm: fakeCaller([JSON.stringify(WRONG_AMOUNT_LETTER)]), allowTemplateFallback: false }),
    ).rejects.toMatchObject({ code: "INVALID_AI_OUTPUT" });
  });
});

describe("claim guard", () => {
  const llm = fakeCaller([JSON.stringify(VALID_LETTER)]);

  it.each([
    ["NEEDS_REVIEW status", { status: "NEEDS_REVIEW" as unknown as "VERIFIED" }],
    ["difference ≠ billed − expected", { differenceMinor: 1900000 }],
    ["non-positive difference", { differenceMinor: 0, expectedAmountMinor: 4250000 }],
    ["fractional amount", { billedAmountMinor: 4250000.5 }],
    ["unverified invoice evidence", { invoiceEvidence: { ...demoFinding().invoiceEvidence, verified: false } }],
    ["empty contract excerpt", { contractEvidence: { ...demoFinding().contractEvidence, excerpt: "  " } }],
  ])("rejects %s with CLAIM_NOT_ALLOWED", async (_name, overrides) => {
    await expect(generateClaim(demoFinding(overrides), { llm })).rejects.toMatchObject({ code: "CLAIM_NOT_ALLOWED" });
  });

  it("rejects a finding without evidence even when fallback is allowed", async () => {
    const tampered = { ...demoFinding(), contractEvidence: undefined } as unknown as VerifiedDiscrepancy;
    await expect(generateClaim(tampered)).rejects.toMatchObject({ code: "CLAIM_NOT_ALLOWED" });
  });
});

describe("buildTemplateClaim", () => {
  it("states exact amounts, quotes both excerpts and contains no forbidden content", () => {
    const finding = demoFinding();
    const { subject, body } = buildTemplateClaim(finding);
    expect(subject).toBe("Freight Invoice Dispute — FR-2026-0842 (Shipment SHIP-00421)");
    expect(body).toMatch(/^Dear Billing Team,/u);
    expect(body).toContain("EUR 42,500.00");
    expect(body).toContain("EUR 24,000.00");
    expect(body).toContain("EUR 18,500.00");
    expect(body).toContain(INVOICE_EXCERPT);
    expect(body).toContain(CONTRACT_EXCERPT);
    expect(body).toContain("invoice-sample.pdf, page 1");
    expect(body).toContain("contract-sample.pdf, page 2, clause 4.2.1");
    expect(body).toMatch(/credit note or reimbursement/u);
    expect(body).toMatch(/Kind regards,\nFreight Audit Team$/u);
    expect(`${subject}\n${body}`).not.toMatch(FORBIDDEN);
    expect(validateClaimText(subject, body, finding)).toEqual([]);
  });

  it("shows unit × quantity when more than one container", () => {
    const finding = demoFinding({
      quantity: 2,
      billedAmountMinor: 8500000,
      expectedAmountMinor: 4800000,
      differenceMinor: 3700000,
      calculation: "EUR 85,000.00 − (EUR 24,000.00 × 2) = EUR 37,000.00",
    });
    const { subject, body } = buildTemplateClaim(finding);
    expect(body).toContain("Contractual amount: EUR 48,000.00 (EUR 24,000.00 × 2)");
    expect(validateClaimText(subject, body, finding)).toEqual([]);
    // Amounts inside the verbatim invoice excerpt are allowed; the same amount outside a quote is not.
    expect(validateClaimText(subject, `${body}\nWe were billed EUR 42,500.00.`, finding).join(" ")).toMatch(/EUR 42,500\.00/u);
  });

  it("renders a copyable text with the draft header", async () => {
    const claim = await generateClaim(demoFinding(), { llm: fakeCaller([new EngineError("AI_UNAVAILABLE", "x")]) });
    const text = renderClaimAsText(claim);
    expect(text.startsWith("DRAFT — requires human approval before sending")).toBe(true);
    expect(text).toContain(`Subject: ${claim.subject}`);
    expect(text).toContain(claim.body);
  });
});

describe("validateClaimText", () => {
  const finding = demoFinding();

  it("accepts the valid letter and amount variants", () => {
    expect(validateClaimText(VALID_LETTER.subject, VALID_LETTER.body, finding)).toEqual([]);
    for (const variant of ["€18,500.00", "€18,500", "EUR 18,500", "18,500.00 EUR"]) {
      const body = `Invoice FR-2026-0842, shipment SHIP-00421: we dispute ${variant}.`;
      expect(validateClaimText("Dispute", body, finding)).toEqual([]);
    }
  });

  it("flags unknown amounts and missing references", () => {
    const problems = validateClaimText("Dispute EUR 1.00", "We dispute EUR 19,000.00.", finding);
    expect(problems.join("\n")).toMatch(/disputed amount/u);
    expect(problems.join("\n")).toMatch(/FR-2026-0842/u);
    expect(problems.join("\n")).toMatch(/SHIP-00421/u);
    expect(problems.join("\n")).toMatch(/EUR 19,000\.00/u);
    expect(problems.join("\n")).toMatch(/EUR 1\.00/u);
  });

  it.each([
    ["The EUR 18,500.00 has already been refunded.", /already been refunded|recovered/u],
    ["Otherwise we will take legal action.", /legal action/u],
    ["We will see you in court.", /court/u],
    ["Signed, [Your Name]", /placeholder/u],
    ["Regards, {{name}}", /placeholder/u],
    ["Regards, <name>", /placeholder/u],
    ["We have recovered the amount.", /recovered/u],
    ["Please pay within 14 days.", /deadline/u],
  ])("catches forbidden content: %s", (sentence, expected) => {
    const body = `Invoice FR-2026-0842, shipment SHIP-00421, disputed EUR 18,500.00. ${sentence}`;
    const problems = validateClaimText("Dispute", body, finding);
    expect(problems.join("\n")).toMatch(expected);
  });
});

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("generateClaim (live Anthropic API)", () => {
  it("generates a validated AI claim with the exact amount", async () => {
    const claim = await generateClaim(demoFinding(), { allowTemplateFallback: false });
    expect(claim.generatedBy).toBe("AI");
    expect(claim.disputedAmountMinor).toBe(1850000);
    expect(claim.body).toMatch(/EUR 18,500\.00|€ ?18,500(\.00)?/u);
    expect(validateClaimText(claim.subject, claim.body, demoFinding())).toEqual([]);
  }, 180_000);
});
