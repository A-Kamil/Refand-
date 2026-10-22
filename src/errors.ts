export type EngineErrorCode =
  | "EMPTY_DOCUMENT"
  | "DOCUMENT_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "UNREADABLE_DOCUMENT"
  | "SCANNED_PDF"
  | "AI_UNAVAILABLE"
  | "AI_REFUSAL"
  | "AI_REQUEST_FAILED"
  | "INVALID_AI_OUTPUT"
  | "INVALID_INPUT"
  | "CLAIM_NOT_ALLOWED";

/** Controlled engine error. The API layer can map `code` to an HTTP status and show `message` to users. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details?: unknown;

  constructor(code: EngineErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.details = details;
  }
}

export function isEngineError(error: unknown): error is EngineError {
  return error instanceof EngineError;
}
