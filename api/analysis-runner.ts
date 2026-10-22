import { analyzeDocuments, auditInvoice, isEngineError, type LlmCaller } from "../src/index.js";
import { withTransaction, type Db } from "./db.js";
import { findDuplicateLines } from "./duplicates.js";
import { fixtureFor, type FixtureStore } from "./fixtures.js";
import {
  failAnalysis,
  getAnalysis,
  getDocument,
  saveAnalysisResults,
  setAnalysisStage,
  toParsedDocument,
  type AnalysisRow,
  type ApiError,
} from "./repository.js";

export type RunnerDeps = {
  db: Db;
  fixtures: FixtureStore | null;
  llm?: LlmCaller;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
};

/**
 * Orchestrates one analysis: Document Analyst (AI extraction) -> Audit Investigator (deterministic
 * matching + audit, then duplicate check against PostgreSQL) -> persistence. Never throws: failures
 * are stored on the analysis as FAILED with a code and message.
 */
export async function runAnalysis(deps: RunnerDeps, analysisId: string): Promise<AnalysisRow | null> {
  const { db } = deps;
  const analysis = await getAnalysis(db, analysisId);
  if (!analysis) return null;
  const started = Date.now();
  try {
    const [invoiceDoc, contractDoc] = await Promise.all([getDocument(db, analysis.invoice_document_id), getDocument(db, analysis.contract_document_id)]);
    if (!invoiceDoc || !contractDoc) throw new RunError("DOCUMENT_NOT_FOUND", "A source document no longer exists.");

    let output;
    if (analysis.requested_mode === "FIXTURE") {
      if (!deps.fixtures) throw new RunError("FIXTURE_UNAVAILABLE", "Demo fixtures are not available on this server.");
      await setAnalysisStage(db, analysisId, "EXTRACTING");
      const extracted = fixtureFor(deps.fixtures, invoiceDoc, contractDoc);
      await setAnalysisStage(db, analysisId, "MATCHING_AND_AUDITING");
      output = { extracted, audit: auditInvoice(extracted) };
    } else {
      output = await analyzeDocuments(toParsedDocument(invoiceDoc), toParsedDocument(contractDoc), {
        ...(deps.llm ? { llm: deps.llm } : {}),
        onStage: (stage) => setAnalysisStage(db, analysisId, stage),
      });
    }

    await setAnalysisStage(db, analysisId, "DUPLICATE_CHECK_AND_PERSISTENCE");
    const { status, duplicates } = await withTransaction(db, (client) =>
      saveAnalysisResults(client, analysis, output.extracted, output.audit, (invoiceId) => findDuplicateLines(client, invoiceId)),
    );
    deps.log.info(
      { analysisId, status, method: output.extracted.meta.method, discrepancies: output.audit.discrepancies.length, duplicates: duplicates.length, ms: Date.now() - started },
      "analysis finished",
    );
  } catch (error) {
    const apiError = toApiError(error);
    deps.log.error({ analysisId, err: error, code: apiError.code }, "analysis failed");
    await failAnalysis(db, analysisId, apiError).catch((e: unknown) => deps.log.error({ err: e }, "could not mark analysis FAILED"));
  }
  return getAnalysis(db, analysisId);
}

export class RunError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function toApiError(error: unknown): ApiError {
  if (isEngineError(error) || error instanceof RunError) return { code: error.code, message: error.message };
  return { code: "INTERNAL_ERROR", message: "Unexpected server error during analysis." };
}
