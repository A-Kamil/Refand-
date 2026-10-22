// Public API of the FreightRecover AI engine. The API layer should import from here only.

export * from "./types/shared.js";
export { EngineError, isEngineError, type EngineErrorCode } from "./errors.js";

export { parseDocument, MAX_DOCUMENT_BYTES, type ParseDocumentInput } from "./services/document-parser.js";
export { extractDocuments, type ExtractionInput, type ExtractionOptions } from "./services/extraction.js";
export { auditInvoice, type AuditOptions } from "./services/audit.js";
export { detectDuplicates, type DuplicateCheckOptions, type DuplicateCheckResult } from "./services/duplicates.js";
export { calculateOvercharge, findApplicableRate, matchRate, type RateMatch } from "./services/contract-matcher.js";
export {
  assertClaimable,
  buildTemplateClaim,
  generateClaim,
  renderClaimAsText,
  type GenerateClaimOptions,
} from "./services/claims.js";
export { formatMinor } from "./services/normalization.js";
export { analyzeDocuments, type AnalysisOptions, type AnalysisOutput, type AnalysisStage } from "./pipeline.js";
export { createAnthropicCaller, hasAnthropicCredentials, type LlmCaller } from "./ai/client.js";
