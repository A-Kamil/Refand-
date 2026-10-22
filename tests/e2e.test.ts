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
