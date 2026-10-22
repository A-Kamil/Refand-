/**
 * Builds fixtures/extracted-sample.json by running the recorded model outputs
 * (fixtures/model-output-*.json) through the real validation pipeline against the .txt fixtures.
 * The result is labelled meta.method = "FIXTURE": it must never be presented as a live AI extraction.
 *
 * Usage: npx tsx scripts/build-extracted-fixture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildExtractedData,
  parseContractOutput,
  parseInvoiceOutput,
  toExtractionDocument,
} from "../src/services/extraction.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const read = (name: string) => readFileSync(join(fixtures, name), "utf8");

const fixtureDoc = (filename: string, kind: "INVOICE" | "CONTRACT") =>
  toExtractionDocument({ documentId: filename.replace(/\.txt$/u, ""), filename, text: read(filename) }, kind);

const invoiceDoc = fixtureDoc("invoice-sample.txt", "INVOICE");
const contractDoc = fixtureDoc("contract-sample.txt", "CONTRACT");

const data = buildExtractedData(
  parseInvoiceOutput(read("model-output-invoice.json"), invoiceDoc),
  parseContractOutput(read("model-output-contract.json"), contractDoc),
  // Fixed timestamp keeps the fixture byte-stable across rebuilds.
  { method: "FIXTURE", extractedAt: "2026-10-22T00:00:00.000Z" },
);

const unverified = data.warnings.filter((w) => w.includes("not found verbatim"));
if (unverified.length > 0) {
  console.error("Fixture has unverified evidence:\n" + unverified.join("\n"));
  process.exit(1);
}

writeFileSync(join(fixtures, "extracted-sample.json"), JSON.stringify(data, null, 2) + "\n");
console.log(`Wrote fixtures/extracted-sample.json (${data.invoice.lines.length} line(s), ${data.rates.length} rate(s), ${data.warnings.length} warning(s)).`);
