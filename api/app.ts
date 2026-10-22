import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { isEngineError, MAX_DOCUMENT_BYTES, type LlmCaller } from "../src/index.js";
import type { Db } from "./db.js";
import type { FixtureStore } from "./fixtures.js";
import { registerRoutes, sendError } from "./routes.js";

export type AppOptions = {
  db: Db;
  fixtures: FixtureStore | null;
  corsOrigins: string[];
  llm?: LlmCaller;
  logLevel?: string;
};

/** EngineError code -> HTTP status, as documented in INTEGRATION.md. */
const ENGINE_STATUS: Record<string, number> = {
  EMPTY_DOCUMENT: 422,
  UNSUPPORTED_FORMAT: 422,
  UNREADABLE_DOCUMENT: 422,
  SCANNED_PDF: 422,
  INVALID_INPUT: 422,
  DOCUMENT_TOO_LARGE: 413,
  CLAIM_NOT_ALLOWED: 409,
  AI_UNAVAILABLE: 503,
  AI_REQUEST_FAILED: 502,
  AI_REFUSAL: 502,
  INVALID_AI_OUTPUT: 502,
};

function originMatcher(patterns: string[]): (origin: string) => boolean {
  const regexes = patterns.map(
    (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*")}$`, "u"),
  );
  return (origin) => regexes.some((r) => r.test(origin));
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: options.logLevel ?? "info", redact: ["req.headers.authorization", "req.headers.cookie"] },
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { coerceTypes: true, removeAdditional: false } },
  });

  const allowed = originMatcher(options.corsOrigins);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowed(origin)),
    methods: ["GET", "POST", "OPTIONS"],
    exposedHeaders: ["location", "content-disposition"],
    maxAge: 600,
  });
  await app.register(multipart, { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 4, fields: 10 } });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string; validation?: unknown }, req, reply) => {
    if (isEngineError(error)) return sendError(reply, ENGINE_STATUS[error.code] ?? 422, error.code, error.message);
    if (error.validation) return sendError(reply, 400, "VALIDATION_ERROR", error.message);
    if (error.code === "FST_REQ_FILE_TOO_LARGE") return sendError(reply, 413, "DOCUMENT_TOO_LARGE", `Files are limited to ${MAX_DOCUMENT_BYTES} bytes.`);
    if (error.statusCode && error.statusCode < 500) return sendError(reply, error.statusCode, error.code ?? "BAD_REQUEST", error.message);
    req.log.error({ err: error }, "unhandled error");
    return sendError(reply, 500, "INTERNAL_ERROR", "Unexpected server error.");
  });
  app.setNotFoundHandler((req, reply) => sendError(reply, 404, "NOT_FOUND", `Route ${req.method} ${req.url} not found.`));

  const inflight = new Set<Promise<unknown>>();
  app.addHook("onClose", async () => {
    await Promise.allSettled([...inflight]);
  });
  await registerRoutes(app, { db: options.db, fixtures: options.fixtures, inflight, ...(options.llm ? { llm: options.llm } : {}) });
  return app;
}
