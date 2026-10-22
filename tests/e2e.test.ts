import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeDocuments, generateClaim, parseDocument, type LlmCaller } from "../src/index.js";

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** Fake model returning the reference outputs; the rest of the pipeline is real (PDF parsing, validation, audit). */
const fakeLlm: LlmCaller = async (request) => {
  const kind = typeof request.content === "string" && request.content.includes('kind="CONTRACT"') ? "contract" : "invoice";
  return { raw: readFileSync(fixture(`model-output-${kind}.json`), "utf8"), model: "fake-model" };
};

async function parsePdfs() {
  return Promise.all([
    parseDocument({ documentId: "inv-1", filename: "invoice-sample.pdf", kind: "INVOICE", content: readFileSync(fixture("invoice-sample.pdf")) }),
    parseDocument({ documentId: "ctr-1", filename: "contract-sample.pdf", kind: "CONTRACT", content: readFileSync(fixture("contract-sample.pdf")) }),
  ]);
}

describe("end-to-end on PDF fixtures", () => {
  it("parses, extracts, audits and drafts a claim for exactly EUR 18,500.00", async () => {
    const [invoice, contract] = await parsePdfs();
    const stages: string[] = [];
    const { extracted, audit } = await analyzeDocuments(invoice, contract, { llm: fakeLlm, onStage: (s) => void stages.push(s) });

    expect(stages).toEqual(["EXTRACTING", "MATCHING_AND_AUDITING"]);
    expect(extracted.warnings).toEqual([]);
    expect(audit.status).toBe("COMPLETED");
    expect(audit.discrepancies).toHaveLength(1);

    const d = audit.discrepancies[0]!;
    expect(d).toMatchObject({
      invoiceNumber: "FR-2026-0842",
      shipmentId: "SHIP-00421",
      billedAmountMinor: 4250000,
      expectedAmountMinor: 2400000,
      differenceMinor: 1850000,
      status: "VERIFIED",
    });
    expect(d.invoiceEvidence).toMatchObject({ documentId: "inv-1", filename: "invoice-sample.pdf", page: 1, verified: true });
    expect(d.contractEvidence).toMatchObject({ documentId: "ctr-1", filename: "contract-sample.pdf", page: 2, section: "4.2.1", verified: true });

    const claim = await generateClaim(d, { llm: async () => { throw new Error("offline"); } });
    expect(claim).toMatchObject({ status: "DRAFT", generatedBy: "TEMPLATE", disputedAmountMinor: 1850000, currency: "EUR" });
    expect(claim.body).toContain("EUR 18,500.00");
  });

  it("is JSON-serialisable for PostgreSQL jsonb persistence", async () => {
    const [invoice, contract] = await parsePdfs();
    const output = await analyzeDocuments(invoice, contract, { llm: fakeLlm });
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });
});

describe("end-to-end duplicate billing on PDF fixtures", () => {
  const dupLlm: LlmCaller = async (request) => {
    const content = typeof request.content === "string" ? request.content : "";
    const name = content.includes('kind="CONTRACT"')
      ? "contract"
      : content.includes("FR-2026-0907") ? "invoice-duplicate" : "invoice";
    return { raw: readFileSync(fixture(`model-output-${name}.json`), "utf8"), model: "fake-model" };
  };

  async function runBoth(llm?: LlmCaller) {
    const read = (f: string, id: string, kind: "INVOICE" | "CONTRACT") =>
      parseDocument({ documentId: id, filename: f, kind, content: readFileSync(fixture(f)) });
    const [first, second, contract] = await Promise.all([
      read("invoice-sample.pdf", "inv-1", "INVOICE"),
      read("invoice-duplicate-sample.pdf", "inv-2", "INVOICE"),
      read("contract-sample.pdf", "ctr-1", "CONTRACT"),
    ]);
    const opts = llm ? { llm } : {};
    const a1 = await analyzeDocuments(first, contract, { ...opts, history: [] });
    const history = [{ analysisId: "an-1", status: "ACTIVE" as const, invoice: a1.extracted.invoice }];
    const a2 = await analyzeDocuments(second, contract, { ...opts, history, currentAnalysisId: "an-2" });
    const again = await analyzeDocuments(first, contract, { ...opts, history, currentAnalysisId: "an-3" });
    return { a1, a2, again };
  }

  function check({ a1, a2, again }: Awaited<ReturnType<typeof runBoth>>) {
    expect(a1.audit.totals.verifiedOverchargeMinor).toBe(1850000);
    expect(a1.extracted.invoice.contentHash).toMatch(/^[0-9a-f]{64}$/u);

    expect(a2.audit.status).toBe("COMPLETED");
    const dup = a2.audit.discrepancies.find((d) => d.type === "DUPLICATE_CHARGE");
    expect(dup).toMatchObject({
      invoiceNumber: "FR-2026-0907",
      differenceMinor: 4250000,
      original: { analysisId: "an-1", invoiceNumber: "FR-2026-0842", invoiceDate: "2026-10-20" },
      invoiceEvidence: { filename: "invoice-duplicate-sample.pdf", page: 1, verified: true },
      originalEvidence: { filename: "invoice-sample.pdf", page: 1, verified: true },
    });
    const rate = a2.audit.discrepancies.find((d) => d.type === "RATE_MISMATCH");
    expect(rate).toMatchObject({ differenceMinor: 1850000, supersededBy: dup!.id });
    expect(a2.audit.totals.verifiedOverchargeMinor).toBe(4250000);

    // Re-uploading the first invoice (same bytes) is a re-analysis, not a duplicate.
    expect(again.audit.status).toBe("COMPLETED");
    expect(again.audit.discrepancies.map((d) => d.type)).toEqual(["RATE_MISMATCH"]);
    expect(again.audit.duplicateCheck.sameDocumentAnalysisIds).toEqual(["an-1"]);
  }

  it("detects the duplicate with a fake model", async () => {
    check(await runBoth(dupLlm));
  });

  it.skipIf(!process.env.ANTHROPIC_API_KEY)("detects the duplicate with real AI extraction", async () => {
    check(await runBoth());
  }, 180_000);
});
