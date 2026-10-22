/**
 * End-to-end engine demo: parse -> AI extraction -> deterministic audit -> recovery claim.
 *
 *   npm run demo                              # PDF fixtures, real AI calls (needs ANTHROPIC_API_KEY)
 *   npm run demo -- --invoice a.pdf --contract b.pdf
 *   npm run demo -- --fixture                 # offline: pre-built FIXTURE extraction, clearly labelled
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeDocuments,
  auditInvoice,
  formatMinor,
  generateClaim,
  isEngineError,
  parseDocument,
  renderClaimAsText,
  type AnalysisOutput,
  type ExtractedData,
} from "../src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function loadDocument(file: string, kind: "INVOICE" | "CONTRACT") {
  const content = await readFile(file);
  return parseDocument({ documentId: path.basename(file, path.extname(file)), filename: path.basename(file), kind, content });
}

async function main(): Promise<void> {
  let output: AnalysisOutput;
  if (args.includes("--fixture")) {
    console.log("MODE: FIXTURE — pre-built structured extraction, NOT a live AI extraction.\n");
    const extracted = JSON.parse(await readFile(path.join(root, "fixtures/extracted-sample.json"), "utf8")) as ExtractedData;
    output = { extracted, audit: auditInvoice(extracted) };
  } else {
    const invoicePath = argValue("--invoice") ?? path.join(root, "fixtures/invoice-sample.pdf");
    const contractPath = argValue("--contract") ?? path.join(root, "fixtures/contract-sample.pdf");
    console.log(`MODE: LIVE AI — ${path.basename(invoicePath)} + ${path.basename(contractPath)}\n`);
    const [invoice, contract] = await Promise.all([loadDocument(invoicePath, "INVOICE"), loadDocument(contractPath, "CONTRACT")]);
    const started = Date.now();
    output = await analyzeDocuments(invoice, contract, { onStage: (s) => console.log(`[stage] ${s} (+${Date.now() - started} ms)`) });
    console.log(`[stage] DONE (+${Date.now() - started} ms), model: ${output.extracted.meta.model ?? "n/a"}\n`);
  }

  const { extracted, audit } = output;
  console.log(`Extraction method: ${extracted.meta.method}`);
  console.log(`Invoice ${extracted.invoice.invoiceNumber} | shipment ${extracted.invoice.shipmentId} | ${extracted.invoice.lines.length} line(s) | ${extracted.rates.length} contract rate(s)`);
  for (const w of audit.warnings) console.log(`  warning: ${w}`);
  console.log(`\nAudit status: ${audit.status}`);
  for (const r of audit.lineResults) console.log(`  line ${r.invoiceLineId}: ${r.outcome}${r.matchedRateId ? ` (rate ${r.matchedRateId})` : ""}`);
  for (const item of audit.reviewItems) console.log(`  review: [${item.code}] ${item.message}`);

  for (const d of audit.discrepancies) {
    console.log(`\nVERIFIED ${d.type}: ${d.calculation}`);
    console.log(`  invoice evidence : ${d.invoiceEvidence.filename} p.${d.invoiceEvidence.page ?? "-"} "${d.invoiceEvidence.excerpt}"`);
    console.log(`  contract evidence: ${d.contractEvidence.filename} p.${d.contractEvidence.page ?? "-"} clause ${d.contractEvidence.section ?? "-"} "${d.contractEvidence.excerpt}"`);
    console.log(`  ${d.explanation}`);

    const claim = await generateClaim(d);
    console.log(`\nRecovery claim (generatedBy: ${claim.generatedBy}${claim.model ? `, ${claim.model}` : ""}) — disputed ${formatMinor(claim.disputedAmountMinor, claim.currency)}`);
    for (const w of claim.warnings) console.log(`  claim warning: ${w}`);
    console.log(`\n${renderClaimAsText(claim)}`);
  }
  if (audit.discrepancies.length === 0) console.log("\nNo verified discrepancy.");
}

main().catch((error: unknown) => {
  if (isEngineError(error)) {
    console.error(`EngineError ${error.code}: ${error.message}`);
    if (error.code === "AI_UNAVAILABLE") console.error("Set ANTHROPIC_API_KEY, or run `npm run demo -- --fixture` for the offline fixture.");
  } else {
    console.error(error);
  }
  process.exit(1);
});
