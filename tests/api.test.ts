/**
 * API integration tests against a real PostgreSQL. Each run uses its own throw-away schema.
 *   TEST_DATABASE_URL=postgres://postgres:dev@localhost:55432/freightrecover npm test
 * Skipped when TEST_DATABASE_URL is not set.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../api/app.js";
import { poolConfig } from "../api/db.js";
import { loadFixtures } from "../api/fixtures.js";
import { migrate } from "../api/migrations.js";
import { seed } from "../api/seed.js";
import type { LlmCaller } from "../src/index.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));
const fixture = (name: string) => readFileSync(`${fixturesDir}/${name}`);

const DEMO_INVOICE_PDF = "00000000-0000-4000-8000-000000000001";
const DEMO_CONTRACT_PDF = "00000000-0000-4000-8000-000000000002";

/** Fake model: reference extraction outputs; claim drafting fails so the template fallback is used. */
const fakeLlm: LlmCaller = async (request) => {
  if (request.label === "recovery claim drafting") throw new Error("offline");
  const kind = request.label === "contract extraction" ? "contract" : "invoice";
  return { raw: fixture(`model-output-${kind}.json`).toString("utf8"), model: "fake-model" };
};

function multipart(files: Array<{ field: string; filename: string; content: Buffer; type: string }>) {
  const boundary = `----test${Date.now()}`;
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    chunks.push(f.content, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe.skipIf(!DATABASE_URL)("API (PostgreSQL)", () => {
  const schema = `test_${process.pid}_${Date.now()}`;
  let db: pg.Pool;
  let app: FastifyInstance;
  let appWithoutAi: FastifyInstance;

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    const admin = new pg.Pool(poolConfig(DATABASE_URL!));
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    db = new pg.Pool({ ...poolConfig(DATABASE_URL!), options: `-c search_path=${schema}` });
    await migrate(db);
    await seed(db, fixturesDir);
    const fixtures = await loadFixtures(fixturesDir);
    app = await buildApp({ db, fixtures, corsOrigins: ["https://*.lovable.app"], llm: fakeLlm, logLevel: "silent" });
    appWithoutAi = await buildApp({ db, fixtures, corsOrigins: [], logLevel: "silent" });
  });

  afterAll(async () => {
    await app?.close();
    await appWithoutAi?.close();
    await db?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db?.end();
  });

  async function upload(files: Parameters<typeof multipart>[0]) {
    const res = await app.inject({ method: "POST", url: "/api/documents/upload", ...multipart(files) });
    return { status: res.statusCode, body: res.json() };
  }

  async function analyze(body: Record<string, unknown>, target = app) {
    const res = await target.inject({ method: "POST", url: "/api/analyses", payload: { wait: true, ...body } });
    return { status: res.statusCode, body: res.json() };
  }

  it("GET /health checks the API and the database", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", api: "ok", db: { ok: true }, ai: { configured: true }, fixtures: { available: true } });
  });

  it("seeds the demo documents idempotently", async () => {
    expect(await seed(db, fixturesDir)).toEqual({ documents: 0, invoices: 0 });
    const res = await app.inject({ method: "GET", url: "/api/documents?demo=true" });
    expect(res.json().documents.map((d: { id: string }) => d.id).sort()).toContain(DEMO_INVOICE_PDF);
  });

  it("uploads PDFs, runs the AI pipeline and persists the EUR 18,500.00 overcharge", async () => {
    const up = await upload([
      { field: "invoice", filename: "invoice-sample.pdf", content: fixture("invoice-sample.pdf"), type: "application/pdf" },
      { field: "contract", filename: "contract-sample.pdf", content: fixture("contract-sample.pdf"), type: "application/pdf" },
    ]);
    expect(up.status).toBe(201);
    expect(up.body.documents).toHaveLength(2);

    const { status, body } = await analyze({ invoiceDocumentId: up.body.invoiceDocumentId, contractDocumentId: up.body.contractDocumentId });
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "COMPLETED", extractionMethod: "AI", model: "fake-model", totals: { verifiedRecoverableMinor: 1850000 } });
    expect(body.steps.map((s: { status: string }) => s.status)).toEqual(["done", "done", "done"]);
    expect(body.discrepancies).toHaveLength(1);
    const d = body.discrepancies[0];
    expect(d).toMatchObject({
      type: "RATE_MISMATCH",
      status: "VERIFIED",
      claimable: true,
      billedAmountMinor: 4250000,
      expectedAmountMinor: 2400000,
      differenceMinor: 1850000,
      calculation: "EUR 42,500.00 − (EUR 24,000.00 × 1) = EUR 18,500.00",
    });
    expect(d.evidence.contractEvidence).toMatchObject({ documentId: up.body.contractDocumentId, page: 2, section: "4.2.1", verified: true });

    const { rows } = await db.query(
      `SELECT (SELECT count(*)::int FROM invoices WHERE analysis_id = $1) AS invoices,
              (SELECT count(*)::int FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.analysis_id = $1) AS lines,
              (SELECT count(*)::int FROM contract_rates r JOIN contracts c ON c.id = r.contract_id WHERE c.analysis_id = $1) AS rates`,
      [body.id],
    );
    expect(rows[0]).toEqual({ invoices: 1, lines: 1, rates: 3 });

    const detail = (await app.inject({ method: "GET", url: `/api/discrepancies/${d.id}` })).json();
    expect(detail).toMatchObject({ contractRate: { id: "AOL-SVC-2026-017#4.2.1", unitRateMinor: 2400000 }, invoice: { invoiceNumber: "FR-2026-0842" }, claim: null });
  });

  it("drafts, caches and downloads a recovery claim", async () => {
    const list = (await app.inject({ method: "GET", url: "/api/discrepancies?type=RATE_MISMATCH" })).json();
    const id = list.discrepancies[0].id;

    const first = await app.inject({ method: "POST", url: `/api/discrepancies/${id}/claim` });
    expect(first.statusCode).toBe(201);
    const claim = first.json();
    expect(claim).toMatchObject({ status: "DRAFT", requiresHumanApproval: true, generatedBy: "TEMPLATE", disputedAmountMinor: 1850000, currency: "EUR" });
    expect(claim.text).toContain("EUR 18,500.00");

    const again = await app.inject({ method: "POST", url: `/api/discrepancies/${id}/claim`, payload: {} });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(claim.id);

    const regenerated = await app.inject({ method: "POST", url: `/api/discrepancies/${id}/claim`, payload: { regenerate: true } });
    expect(regenerated.statusCode).toBe(201);
    expect(regenerated.json().id).not.toBe(claim.id);

    const dl = await app.inject({ method: "GET", url: claim.downloadUrl });
    expect(dl.headers["content-disposition"]).toContain("recovery-claim-FR-2026-0842.txt");
    expect(dl.body).toContain("EUR 18,500.00");
  });

  it("flags the same invoice received as another file as a potential duplicate, not claimable", async () => {
    const up = await upload([{ field: "invoice", filename: "invoice-sample.csv", content: fixture("invoice-sample.csv"), type: "text/csv" }]);
    const { body } = await analyze({ invoiceDocumentId: up.body.invoiceDocumentId, contractDocumentId: DEMO_CONTRACT_PDF, extractionMode: "FIXTURE" });
    expect(body).toMatchObject({ status: "NEEDS_REVIEW", extractionMethod: "FIXTURE", totals: { verifiedRecoverableMinor: 1850000, potentialDuplicateMinor: 4250000 } });
    const dup = body.discrepancies.find((d: { type: string }) => d.type === "DUPLICATE_BILLING");
    expect(dup).toMatchObject({ status: "NEEDS_REVIEW", claimable: false, differenceMinor: 4250000 });
    expect(dup.evidence.previousInvoice).toMatchObject({ invoiceNumber: "FR-2026-0842", filename: "invoice-sample.pdf" });

    const claim = await app.inject({ method: "POST", url: `/api/discrepancies/${dup.id}/claim` });
    expect(claim.statusCode).toBe(409);
    expect(claim.json().error.code).toBe("CLAIM_NOT_ALLOWED");
  });

  it("ignores earlier analyses of the exact same file when looking for duplicates", async () => {
    const { body } = await analyze({ invoiceDocumentId: DEMO_INVOICE_PDF, contractDocumentId: DEMO_CONTRACT_PDF, extractionMode: "FIXTURE" });
    // The demo PDF has the same bytes as the uploaded PDF, but the CSV analysed above is a different file.
    const dups = body.discrepancies.filter((d: { type: string }) => d.type === "DUPLICATE_BILLING");
    expect(dups).toHaveLength(1);
    expect(dups[0].evidence.previousInvoice.filename).toBe("invoice-sample.csv");
  });

  it("runs asynchronously and exposes progress via GET /api/analyses/:id", async () => {
    const res = await app.inject({ method: "POST", url: "/api/analyses", payload: { invoiceDocumentId: DEMO_INVOICE_PDF, contractDocumentId: DEMO_CONTRACT_PDF, extractionMode: "FIXTURE" } });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("PENDING");
    let status = "PENDING";
    for (let i = 0; i < 50 && ["PENDING", "PROCESSING"].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = (await app.inject({ method: "GET", url: `/api/analyses/${res.json().id}` })).json().status;
    }
    expect(["COMPLETED", "NEEDS_REVIEW"]).toContain(status);
  });

  it("refuses FIXTURE mode on non-demo documents and AI mode without credentials", async () => {
    const up = await upload([{ field: "invoice", filename: "other.txt", content: Buffer.from("Invoice No: X-1\nTotal: EUR 10.00\n"), type: "text/plain" }]);
    const fixtureRes = await analyze({ invoiceDocumentId: up.body.invoiceDocumentId, contractDocumentId: DEMO_CONTRACT_PDF, extractionMode: "FIXTURE" });
    expect(fixtureRes.status).toBe(422);
    expect(fixtureRes.body.error.code).toBe("FIXTURE_NOT_ALLOWED");

    const aiRes = await analyze({ invoiceDocumentId: DEMO_INVOICE_PDF, contractDocumentId: DEMO_CONTRACT_PDF }, appWithoutAi);
    expect(aiRes.status).toBe(503);
    expect(aiRes.body.error.code).toBe("AI_UNAVAILABLE");
  });

  it("stores an analysis as FAILED when the AI output is invalid", async () => {
    const broken = await buildApp({ db, fixtures: null, corsOrigins: [], llm: async () => ({ raw: "not json", model: "fake" }), logLevel: "silent" });
    const { status, body } = await analyze({ invoiceDocumentId: DEMO_INVOICE_PDF, contractDocumentId: DEMO_CONTRACT_PDF }, broken);
    await broken.close();
    expect(status).toBe(200);
    expect(body.status).toBe("FAILED");
    expect(body.error.code).toBe("INVALID_AI_OUTPUT");
  });

  it("rejects invalid uploads and requests", async () => {
    const csvContract = await upload([{ field: "contract", filename: "c.csv", content: fixture("invoice-sample.csv"), type: "text/csv" }]);
    expect(csvContract.status).toBe(422);
    expect(csvContract.body.error.code).toBe("UNSUPPORTED_FORMAT");

    const swapped = await analyze({ invoiceDocumentId: DEMO_CONTRACT_PDF, contractDocumentId: DEMO_INVOICE_PDF, extractionMode: "FIXTURE" });
    expect(swapped.status).toBe(422);

    const invalid = await app.inject({ method: "POST", url: "/api/analyses", payload: { invoiceDocumentId: "x" } });
    expect(invalid.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/analyses/00000000-0000-4000-8000-00000000ffff" })).statusCode).toBe(404);
  });

  it("serves the dashboard with simulated and live figures kept apart", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
    expect(body.simulatedPortfolio).toMatchObject({ simulated: true, annualFreightSpendMinor: 12_500_000_000, potentiallyRecoverableMinor: 320_000_000, invoicesAnalyzed: 48_250, anomaliesIdentified: 1_842 });
    expect(body.live).toMatchObject({ simulated: false, verifiedRecoverableMinor: 1850000, claims: { total: 2, template: 2 } });
    expect(body.live.discrepancies.byType).toContainEqual({ type: "DUPLICATE_BILLING", count: 1, amountMinor: 4250000 });
  });

  it("allows CORS for Lovable origins only", async () => {
    const ok = await app.inject({ method: "OPTIONS", url: "/api/analyses", headers: { origin: "https://my-app.lovable.app", "access-control-request-method": "POST" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("https://my-app.lovable.app");
    const ko = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } });
    expect(ko.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
