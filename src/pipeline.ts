import type { LlmCaller } from "./ai/client.js";
import { auditInvoice } from "./services/audit.js";
import { extractDocuments, type ExtractionInput } from "./services/extraction.js";
import type { AuditResult, ExtractedData } from "./types/shared.js";

/**
 * Real processing stages, reported when they actually start.
 * Matching and the monetary audit run together in one synchronous deterministic step.
 */
export type AnalysisStage = "EXTRACTING" | "MATCHING_AND_AUDITING";

export type AnalysisOptions = {
  llm?: LlmCaller;
  onStage?: (stage: AnalysisStage) => void | Promise<void>;
};

export type AnalysisOutput = {
  extracted: ExtractedData;
  audit: AuditResult;
};

/** Parsed invoice + contract -> AI extraction -> deterministic matching and audit. Throws EngineError on failure. */
export async function analyzeDocuments(
  invoice: ExtractionInput,
  contract: ExtractionInput,
  options: AnalysisOptions = {},
): Promise<AnalysisOutput> {
  await options.onStage?.("EXTRACTING");
  const extracted = await extractDocuments(invoice, contract, options.llm ? { llm: options.llm } : {});
  await options.onStage?.("MATCHING_AND_AUDITING");
  const audit = auditInvoice(extracted);
  return { extracted, audit };
}
