import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentKind, ExtractedData } from "../src/index.js";

export const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Demo documents loaded by the seed, with stable ids so the frontend can reference them. */
export const DEMO_DOCUMENTS: Array<{ id: string; file: string; kind: DocumentKind; mimeType: string }> = [
  { id: "00000000-0000-4000-8000-000000000001", file: "invoice-sample.pdf", kind: "INVOICE", mimeType: "application/pdf" },
  { id: "00000000-0000-4000-8000-000000000002", file: "contract-sample.pdf", kind: "CONTRACT", mimeType: "application/pdf" },
  { id: "00000000-0000-4000-8000-000000000003", file: "invoice-sample.csv", kind: "INVOICE", mimeType: "text/csv" },
];

/** Every file that describes the demo case; FIXTURE extraction is only allowed on these. */
const FIXTURE_SOURCE_FILES = ["invoice-sample.pdf", "invoice-sample.csv", "invoice-sample.txt", "contract-sample.pdf", "contract-sample.txt"];

export type FixtureStore = {
  /** SHA-256 of the demo source files. */
  hashes: Set<string>;
  /** Pre-built structured extraction of the demo case, labelled `meta.method: "FIXTURE"`. */
  extraction: ExtractedData;
};

export async function loadFixtures(dir: string): Promise<FixtureStore | null> {
  try {
    const hashes = new Set<string>();
    for (const f of FIXTURE_SOURCE_FILES) hashes.add(sha256(await readFile(path.join(dir, f))));
    const extraction = JSON.parse(await readFile(path.join(dir, "extracted-sample.json"), "utf8")) as ExtractedData;
    return { hashes, extraction };
  } catch {
    return null;
  }
}

/** Re-targets the fixture extraction to the stored documents so evidence links point to them. */
export function fixtureFor(store: FixtureStore, invoice: { id: string; filename: string }, contract: { id: string; filename: string }): ExtractedData {
  const data = structuredClone(store.extraction);
  data.invoice.documentId = invoice.id;
  data.invoice.filename = invoice.filename;
  for (const line of data.invoice.lines) Object.assign(line.source, { documentId: invoice.id, filename: invoice.filename });
  for (const rate of data.rates) Object.assign(rate.source, { documentId: contract.id, filename: contract.filename });
  data.meta = { ...data.meta, method: "FIXTURE", extractedAt: new Date().toISOString() };
  return data;
}
