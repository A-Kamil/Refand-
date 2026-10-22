import type { FastifyInstance, FastifyReply } from "fastify";
import {
  generateClaim,
  hasAnthropicCredentials,
  isEngineError,
  parseDocument,
  renderClaimAsText,
  type DocumentKind,
  type LlmCaller,
  type RateMismatchDiscrepancy,
  type VerifiedDiscrepancy,
} from "../src/index.js";
import { runAnalysis } from "./analysis-runner.js";
import { checkDb, type Db } from "./db.js";
import { getDashboard } from "./dashboard.js";
import { sha256, type FixtureStore } from "./fixtures.js";
import {
  claimDto,
  createAnalysis,
  discrepancyDto,
  documentDto,
  getAnalysis,
  getClaim,
  getDiscrepancy,
  getDocument,
  getDocumentContent,
  getLatestClaim,
  insertClaim,
  insertDocument,
  listAnalyses,
  listDiscrepancies,
  listDocuments,
  type AnalysisRow,
  type DocumentRow,
  type ExtractionMode,
} from "./repository.js";

export type RouteDeps = {
  db: Db;
  fixtures: FixtureStore | null;
  llm?: LlmCaller;
  /** Background analyses still running; awaited on shutdown. */
  inflight: Set<Promise<unknown>>;
};

const uuidParam = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

export function sendError(reply: FastifyReply, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return reply.code(status).send({ error: { code, message }, ...extra });
}

const STEPS = [
  { key: "EXTRACTION", label: "Document extraction", stage: "EXTRACTING" },
  { key: "RATE_LOOKUP_AND_COMPARISON", label: "Contract rate lookup and comparison", stage: "MATCHING_AND_AUDITING" },
  { key: "DETECTION", label: "Anomaly and duplicate detection", stage: "DUPLICATE_CHECK_AND_PERSISTENCE" },
] as const;

function analysisSteps(a: AnalysisRow) {
  const reached = new Set(a.stage_history.map((h) => h.stage));
  const finished = a.status === "COMPLETED" || a.status === "NEEDS_REVIEW";
  return STEPS.map((s) => {
    const at = a.stage_history.find((h) => h.stage === s.stage)?.at ?? null;
    let status: "pending" | "running" | "done" | "failed" = "pending";
    if (finished) status = "done";
    else if (a.stage === s.stage) status = a.status === "FAILED" ? "failed" : "running";
    else if (reached.has(s.stage)) status = "done";
    return { key: s.key, label: s.label, status, startedAt: at };
  });
}

async function analysisDto(db: Db, a: AnalysisRow) {
  const [invoiceDoc, contractDoc, discrepancies] = await Promise.all([
    getDocument(db, a.invoice_document_id),
    getDocument(db, a.contract_document_id),
    listDiscrepancies(db, { analysisId: a.id }),
  ]);
  const items = discrepancies.map(discrepancyDto);
  return {
    id: a.id,
    status: a.status,
    stage: a.stage,
    steps: analysisSteps(a),
    stageHistory: a.stage_history,
    requestedMode: a.requested_mode,
    extractionMethod: a.extraction_method,
    model: a.model,
    documents: { invoice: invoiceDoc && documentDto(invoiceDoc), contract: contractDoc && documentDto(contractDoc) },
    invoice: a.extracted?.invoice ?? null,
    contractRates: a.extracted?.rates ?? [],
    extractionWarnings: a.extracted?.warnings ?? [],
    audit: a.audit && {
      status: a.audit.status,
      lineResults: a.audit.lineResults,
      reviewItems: a.audit.reviewItems,
      warnings: a.audit.warnings,
    },
    discrepancies: items,
    totals: {
      currency: a.audit?.totals.currency ?? null,
      verifiedRecoverableMinor: items.filter((d) => d.status === "VERIFIED").reduce((s, d) => s + (d.differenceMinor ?? 0), 0),
      potentialDuplicateMinor: items.filter((d) => d.type === "DUPLICATE_BILLING").reduce((s, d) => s + (d.differenceMinor ?? 0), 0),
    },
    error: a.error,
    createdAt: a.created_at,
    startedAt: a.started_at,
    completedAt: a.completed_at,
    durationMs: a.started_at && a.completed_at ? a.completed_at.getTime() - a.started_at.getTime() : null,
  };
}

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db } = deps;
  const aiConfigured = () => Boolean(deps.llm) || hasAnthropicCredentials();

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------
  const health = async (_req: unknown, reply: FastifyReply) => {
    const dbHealth = await checkDb(db);
    return reply.code(dbHealth.ok ? 200 : 503).send({
      status: dbHealth.ok ? "ok" : "degraded",
      api: "ok",
      db: dbHealth,
      ai: { configured: aiConfigured() },
      fixtures: { available: Boolean(deps.fixtures) },
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  };
  app.get("/health", health);
  app.get("/api/health", health);

  app.get("/", async () => ({
    name: "FreightRecover AI API",
    health: "/health",
    endpoints: [
      "POST /api/documents/upload",
      "GET /api/documents",
      "GET /api/documents/:id",
      "GET /api/documents/:id/content",
      "POST /api/analyses",
      "GET /api/analyses",
      "GET /api/analyses/:id",
      "GET /api/discrepancies",
      "GET /api/discrepancies/:id",
      "POST /api/discrepancies/:id/claim",
      "GET /api/claims/:id",
      "GET /api/claims/:id/download",
      "GET /api/dashboard",
    ],
  }));

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------
  app.post("/api/documents/upload", async (req, reply) => {
    if (!req.isMultipart()) return sendError(reply, 415, "MULTIPART_REQUIRED", "Send multipart/form-data with fields `invoice` and/or `contract` (or `kind` + `file`).");
    const stored: DocumentRow[] = [];
    let pendingKind: DocumentKind | null = null;
    let fileCount = 0;

    for await (const part of req.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "kind") {
          const value = String(part.value).toUpperCase();
          if (value !== "INVOICE" && value !== "CONTRACT") return sendError(reply, 400, "INVALID_KIND", "`kind` must be INVOICE or CONTRACT.");
          pendingKind = value;
        }
        continue;
      }
      const field = part.fieldname.toLowerCase();
      const kind: DocumentKind | null = field === "invoice" ? "INVOICE" : field === "contract" ? "CONTRACT" : pendingKind;
      if (!kind) return sendError(reply, 400, "INVALID_KIND", `Cannot tell whether "${part.filename}" is an invoice or a contract: use field name \`invoice\`/\`contract\`, or send \`kind\` before \`file\`.`);
      if (++fileCount > 4) return sendError(reply, 400, "TOO_MANY_FILES", "At most 4 files per upload.");

      const content = await part.toBuffer();
      const filename = part.filename || `${kind.toLowerCase()}-upload`;
      const id = crypto.randomUUID();
      let parsed = null;
      let error = null;
      try {
        parsed = await parseDocument({ documentId: id, filename, kind, content, mimeType: part.mimetype });
      } catch (e) {
        if (!isEngineError(e)) throw e;
        error = { code: e.code, message: e.message };
      }
      stored.push(await insertDocument(db, { id, kind, filename, mimeType: part.mimetype ?? null, content, sha256: sha256(content), parsed, error }));
    }

    if (stored.length === 0) return sendError(reply, 400, "NO_FILE", "No file received.");
    const documents = stored.map(documentDto);
    const failed = stored.find((d) => d.status === "FAILED");
    const ids = {
      invoiceDocumentId: stored.find((d) => d.kind === "INVOICE" && d.status === "COMPLETED")?.id ?? null,
      contractDocumentId: stored.find((d) => d.kind === "CONTRACT" && d.status === "COMPLETED")?.id ?? null,
    };
    if (failed) {
      const status = failed.error?.code === "DOCUMENT_TOO_LARGE" ? 413 : 422;
      return sendError(reply, status, failed.error?.code ?? "DOCUMENT_REJECTED", failed.error?.message ?? "Document rejected.", { documents, ...ids });
    }
    return reply.code(201).send({ documents, ...ids });
  });

  app.get<{ Querystring: { demo?: boolean; kind?: DocumentKind } }>(
    "/api/documents",
    { schema: { querystring: { type: "object", properties: { demo: { type: "boolean" }, kind: { type: "string", enum: ["INVOICE", "CONTRACT"] } } } } },
    async (req) => {
      const docs = await listDocuments(db, { ...(req.query.demo !== undefined ? { demo: req.query.demo } : {}), ...(req.query.kind ? { kind: req.query.kind } : {}) });
      return { documents: docs.map(documentDto) };
    },
  );

  app.get<{ Params: { id: string } }>("/api/documents/:id", { schema: { params: uuidParam } }, async (req, reply) => {
    const doc = await getDocument(db, req.params.id);
    if (!doc) return sendError(reply, 404, "NOT_FOUND", "Document not found.");
    return { ...documentDto(doc), pages: doc.pages ?? [] };
  });

  app.get<{ Params: { id: string } }>("/api/documents/:id/content", { schema: { params: uuidParam } }, async (req, reply) => {
    const file = await getDocumentContent(db, req.params.id);
    if (!file) return sendError(reply, 404, "NOT_FOUND", "Document not found.");
    return reply
      .header("content-type", file.mimeType ?? "application/octet-stream")
      .header("content-disposition", `inline; filename="${file.filename.replace(/["\\\r\n]/gu, "_")}"`)
      .send(file.content);
  });

  // -------------------------------------------------------------------------
  // Analyses
  // -------------------------------------------------------------------------
  app.post<{ Body: { invoiceDocumentId: string; contractDocumentId: string; extractionMode?: ExtractionMode; wait?: boolean } }>(
    "/api/analyses",
    {
      schema: {
        body: {
          type: "object",
          required: ["invoiceDocumentId", "contractDocumentId"],
          additionalProperties: false,
          properties: {
            invoiceDocumentId: { type: "string", format: "uuid" },
            contractDocumentId: { type: "string", format: "uuid" },
            extractionMode: { type: "string", enum: ["AI", "FIXTURE"], default: "AI" },
            wait: { type: "boolean", default: false },
          },
        },
      },
    },
    async (req, reply) => {
      const { invoiceDocumentId, contractDocumentId, wait } = req.body;
      const mode = req.body.extractionMode ?? "AI";
      const [invoice, contract] = await Promise.all([getDocument(db, invoiceDocumentId), getDocument(db, contractDocumentId)]);
      if (!invoice) return sendError(reply, 404, "NOT_FOUND", "Invoice document not found.");
      if (!contract) return sendError(reply, 404, "NOT_FOUND", "Contract document not found.");
      if (invoice.kind !== "INVOICE") return sendError(reply, 422, "INVALID_INPUT", "invoiceDocumentId does not reference an invoice.");
      if (contract.kind !== "CONTRACT") return sendError(reply, 422, "INVALID_INPUT", "contractDocumentId does not reference a contract.");
      if (invoice.status !== "COMPLETED" || contract.status !== "COMPLETED") return sendError(reply, 422, "DOCUMENT_REJECTED", "A document could not be parsed; upload a valid file.");

      if (mode === "FIXTURE") {
        if (!deps.fixtures) return sendError(reply, 503, "FIXTURE_UNAVAILABLE", "Demo fixtures are not available on this server.");
        if (!deps.fixtures.hashes.has(invoice.sha256) || !deps.fixtures.hashes.has(contract.sha256)) {
          return sendError(reply, 422, "FIXTURE_NOT_ALLOWED", "FIXTURE mode is only allowed on the bundled demo documents. Use extractionMode AI for other files.");
        }
      } else if (!aiConfigured()) {
        return sendError(reply, 503, "AI_UNAVAILABLE", "ANTHROPIC_API_KEY is not configured on the server. Configure it, or use extractionMode FIXTURE on the demo documents.");
      }

      const analysis = await createAnalysis(db, { invoiceDocumentId, contractDocumentId, mode });
      const run = runAnalysis({ db, fixtures: deps.fixtures, ...(deps.llm ? { llm: deps.llm } : {}), log: req.log }, analysis.id);
      if (wait) {
        const done = await run;
        return reply.code(200).send(await analysisDto(db, done ?? analysis));
      }
      deps.inflight.add(run);
      void run.finally(() => deps.inflight.delete(run));
      return reply.code(202).header("location", `/api/analyses/${analysis.id}`).send(await analysisDto(db, analysis));
    },
  );

  app.get("/api/analyses", async () => {
    const rows = await listAnalyses(db);
    return {
      analyses: rows.map((a) => ({
        id: a.id,
        status: a.status,
        stage: a.stage,
        extractionMethod: a.extraction_method,
        requestedMode: a.requested_mode,
        invoiceNumber: a.invoice_number,
        discrepancyCount: a.discrepancy_count,
        verifiedRecoverableMinor: a.recoverable_minor,
        error: a.error,
        createdAt: a.created_at,
        completedAt: a.completed_at,
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/analyses/:id", { schema: { params: uuidParam } }, async (req, reply) => {
    const a = await getAnalysis(db, req.params.id);
    if (!a) return sendError(reply, 404, "NOT_FOUND", "Analysis not found.");
    return analysisDto(db, a);
  });

  // -------------------------------------------------------------------------
  // Discrepancies & claims
  // -------------------------------------------------------------------------
  app.get<{ Querystring: { analysisId?: string; type?: string; status?: string; limit?: number } }>(
    "/api/discrepancies",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            analysisId: { type: "string", format: "uuid" },
            type: { type: "string", enum: ["RATE_MISMATCH", "DUPLICATE_BILLING"] },
            status: { type: "string", enum: ["VERIFIED", "NEEDS_REVIEW"] },
            limit: { type: "integer", minimum: 1, maximum: 500 },
          },
        },
      },
    },
    async (req) => ({ discrepancies: (await listDiscrepancies(db, req.query)).map(discrepancyDto) }),
  );

  app.get<{ Params: { id: string } }>("/api/discrepancies/:id", { schema: { params: uuidParam } }, async (req, reply) => {
    const row = await getDiscrepancy(db, req.params.id);
    if (!row) return sendError(reply, 404, "NOT_FOUND", "Discrepancy not found.");
    const [analysis, claim] = await Promise.all([getAnalysis(db, row.analysis_id), getLatestClaim(db, row.id)]);
    // Rate-specific fields are absent (null) for duplicate findings.
    const payload = row.payload as Partial<RateMismatchDiscrepancy>;
    return {
      ...discrepancyDto(row),
      quantity: payload.quantity ?? null,
      unitRateMinor: payload.unitRateMinor ?? null,
      matchCriteria: payload.matchCriteria ?? [],
      contractRate: analysis?.extracted?.rates.find((r) => r.id === payload.contractRateId) ?? null,
      invoiceLine: analysis?.extracted?.invoice.lines.find((l) => l.id === payload.invoiceLineId) ?? null,
      invoice: analysis?.extracted ? { ...analysis.extracted.invoice, lines: undefined } : null,
      extractionMethod: analysis?.extraction_method ?? null,
      documents: {
        invoiceDocumentId: analysis?.invoice_document_id ?? null,
        contractDocumentId: analysis?.contract_document_id ?? null,
      },
      claim: claim && claimDto(claim),
    };
  });

  app.post<{ Params: { id: string }; Body: { regenerate?: boolean } | undefined }>(
    "/api/discrepancies/:id/claim",
    { schema: { params: uuidParam, body: { type: ["object", "null"], properties: { regenerate: { type: "boolean" } } } } },
    async (req, reply) => {
      const row = await getDiscrepancy(db, req.params.id);
      if (!row) return sendError(reply, 404, "NOT_FOUND", "Discrepancy not found.");
      if (row.type !== "RATE_MISMATCH" || row.status !== "VERIFIED") {
        return sendError(reply, 409, "CLAIM_NOT_ALLOWED", "Only VERIFIED rate mismatches can become a recovery claim. Potential duplicates must be confirmed against payments first.");
      }
      if (!req.body?.regenerate) {
        const existing = await getLatestClaim(db, row.id);
        if (existing) return reply.code(200).send(claimDto(existing));
      }
      const claim = await generateClaim(row.payload as unknown as VerifiedDiscrepancy, deps.llm ? { llm: deps.llm } : {});
      const saved = await insertClaim(db, row.id, claim, renderClaimAsText(claim));
      return reply.code(201).send(claimDto(saved));
    },
  );

  app.get<{ Params: { id: string } }>("/api/claims/:id", { schema: { params: uuidParam } }, async (req, reply) => {
    const claim = await getClaim(db, req.params.id);
    if (!claim) return sendError(reply, 404, "NOT_FOUND", "Claim not found.");
    return claimDto(claim);
  });

  app.get<{ Params: { id: string } }>("/api/claims/:id/download", { schema: { params: uuidParam } }, async (req, reply) => {
    const claim = await getClaim(db, req.params.id);
    if (!claim) return sendError(reply, 404, "NOT_FOUND", "Claim not found.");
    const name = `recovery-claim-${claim.payload.invoiceNumber}`.replace(/[^A-Za-z0-9._-]/gu, "_");
    return reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("content-disposition", `attachment; filename="${name}.txt"`)
      .send(claim.rendered_text);
  });

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------
  app.get("/api/dashboard", async () => getDashboard(db));
}
