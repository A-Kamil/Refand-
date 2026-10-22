import type {
  AuditResult,
  ContractRate,
  DocumentFormat,
  DocumentKind,
  DocumentSource,
  ExtractedData,
  InvoiceLine,
  ParsedDocument,
  RecoveryClaim,
  VerifiedDiscrepancy,
} from "../src/index.js";
import type { DbClient } from "./db.js";

export type Status = "PENDING" | "PROCESSING" | "COMPLETED" | "NEEDS_REVIEW" | "FAILED";
export type ExtractionMode = "AI" | "FIXTURE";
export type DiscrepancyType = "RATE_MISMATCH" | "DUPLICATE_BILLING";
export type ApiError = { code: string; message: string };

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type DocumentRow = {
  id: string;
  kind: DocumentKind;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  sha256: string;
  format: DocumentFormat | null;
  page_count: number | null;
  pages: string[] | null;
  warnings: string[];
  status: Status;
  error: ApiError | null;
  is_demo: boolean;
  created_at: Date;
};

const DOCUMENT_COLUMNS =
  "id, kind, filename, mime_type, size_bytes, sha256, format, page_count, pages, warnings, status, error, is_demo, created_at";

export type NewDocument = {
  id?: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string | null;
  content: Buffer;
  sha256: string;
  parsed: ParsedDocument | null;
  error: ApiError | null;
  isDemo?: boolean;
};

export async function insertDocument(db: DbClient, doc: NewDocument): Promise<DocumentRow> {
  const { rows } = await db.query<DocumentRow>(
    `INSERT INTO documents (id, kind, filename, mime_type, size_bytes, sha256, format, page_count, pages, warnings, content, status, error, is_demo)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO NOTHING
     RETURNING ${DOCUMENT_COLUMNS}`,
    [
      doc.id ?? null,
      doc.kind,
      doc.filename,
      doc.mimeType,
      doc.content.length,
      doc.sha256,
      doc.parsed?.format ?? null,
      doc.parsed?.pages.length ?? null,
      doc.parsed ? JSON.stringify(doc.parsed.pages) : null,
      JSON.stringify(doc.parsed?.warnings ?? []),
      doc.content,
      doc.parsed ? "COMPLETED" : "FAILED",
      doc.error ? JSON.stringify(doc.error) : null,
      doc.isDemo ?? false,
    ],
  );
  if (rows[0]) return rows[0];
  const existing = await getDocument(db, doc.id!);
  return existing!;
}

export async function getDocument(db: DbClient, id: string): Promise<DocumentRow | null> {
  const { rows } = await db.query<DocumentRow>(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getDocumentContent(db: DbClient, id: string): Promise<{ filename: string; mimeType: string | null; content: Buffer } | null> {
  const { rows } = await db.query<{ filename: string; mime_type: string | null; content: Buffer }>(
    "SELECT filename, mime_type, content FROM documents WHERE id = $1",
    [id],
  );
  const row = rows[0];
  return row ? { filename: row.filename, mimeType: row.mime_type, content: row.content } : null;
}

export async function listDocuments(db: DbClient, filter: { demo?: boolean; kind?: DocumentKind }): Promise<DocumentRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.demo !== undefined) where.push(`is_demo = $${params.push(filter.demo)}`);
  if (filter.kind) where.push(`kind = $${params.push(filter.kind)}`);
  const { rows } = await db.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 100`,
    params,
  );
  return rows;
}

export function toParsedDocument(row: DocumentRow): ParsedDocument {
  const pages = row.pages ?? [];
  return {
    documentId: row.id,
    filename: row.filename,
    kind: row.kind,
    format: row.format ?? "TEXT",
    pages,
    text: pages.join("\n\n"),
    pageNumbered: row.format === "PDF",
    contentHash: row.sha256,
    warnings: row.warnings,
  };
}

export function documentDto(row: DocumentRow) {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    format: row.format,
    pageCount: row.page_count,
    status: row.status,
    warnings: row.warnings,
    error: row.error,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    contentUrl: `/api/documents/${row.id}/content`,
  };
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

export type AnalysisRow = {
  id: string;
  invoice_document_id: string;
  contract_document_id: string;
  status: Status;
  stage: string | null;
  stage_history: Array<{ stage: string; at: string }>;
  extraction_method: ExtractionMode | null;
  requested_mode: ExtractionMode;
  model: string | null;
  extracted: ExtractedData | null;
  audit: AuditResult | null;
  error: ApiError | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export async function createAnalysis(db: DbClient, input: { invoiceDocumentId: string; contractDocumentId: string; mode: ExtractionMode }): Promise<AnalysisRow> {
  const { rows } = await db.query<AnalysisRow>(
    `INSERT INTO analyses (invoice_document_id, contract_document_id, status, requested_mode)
     VALUES ($1, $2, 'PENDING', $3) RETURNING *`,
    [input.invoiceDocumentId, input.contractDocumentId, input.mode],
  );
  return rows[0]!;
}

export async function getAnalysis(db: DbClient, id: string): Promise<AnalysisRow | null> {
  const { rows } = await db.query<AnalysisRow>("SELECT * FROM analyses WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listAnalyses(db: DbClient, limit = 50): Promise<Array<AnalysisRow & { invoice_number: string | null; discrepancy_count: number; recoverable_minor: number }>> {
  const { rows } = await db.query(
    `SELECT a.*, i.invoice_number,
            (SELECT count(*)::int FROM discrepancies d WHERE d.analysis_id = a.id) AS discrepancy_count,
            (SELECT COALESCE(sum(difference_minor), 0) FROM discrepancies d WHERE d.analysis_id = a.id AND d.status = 'VERIFIED') AS recoverable_minor
     FROM analyses a LEFT JOIN invoices i ON i.analysis_id = a.id
     ORDER BY a.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function setAnalysisStage(db: DbClient, id: string, stage: string): Promise<void> {
  await db.query(
    `UPDATE analyses
     SET status = 'PROCESSING', stage = $2, started_at = COALESCE(started_at, now()), updated_at = now(),
         stage_history = stage_history || jsonb_build_array(jsonb_build_object('stage', $2::text, 'at', now()))
     WHERE id = $1`,
    [id, stage],
  );
}

export async function failAnalysis(db: DbClient, id: string, error: ApiError): Promise<void> {
  await db.query(
    `UPDATE analyses SET status = 'FAILED', error = $2, completed_at = now(), updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(error)],
  );
}

/** Analyses left PROCESSING by a previous process cannot resume: mark them FAILED at startup. */
export async function failInterruptedAnalyses(db: DbClient): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE analyses SET status = 'FAILED', completed_at = now(), updated_at = now(),
            error = '{"code":"INTERRUPTED","message":"The server restarted while this analysis was running. Start a new analysis."}'
     WHERE status IN ('PENDING', 'PROCESSING')`,
  );
  return rowCount ?? 0;
}

export type DuplicateFinding = {
  invoiceLineRef: string;
  amountMinor: number;
  currency: string;
  quantity: number | null;
  invoiceNumber: string;
  shipmentId: string;
  carrier: string;
  calculation: string;
  explanation: string;
  invoiceEvidence: DocumentSource;
  previousEvidence: DocumentSource;
  previous: { invoiceId: string; invoiceNumber: string | null; documentId: string | null; filename: string | null; analysisId: string | null; invoiceDate: string | null; matchCount: number };
};

/** Persists extraction, verified discrepancies and duplicate findings, then closes the analysis. */
export async function saveAnalysisResults(
  client: DbClient,
  analysis: AnalysisRow,
  extracted: ExtractedData,
  audit: AuditResult,
  findDuplicates: (invoiceId: string) => Promise<DuplicateFinding[]>,
): Promise<{ status: Status; duplicates: DuplicateFinding[] }> {
  const inv = extracted.invoice;

  // Contract + rates
  const firstRate = extracted.rates[0];
  const { rows: contractRows } = await client.query<{ id: string }>(
    `INSERT INTO contracts (analysis_id, document_id, contract_number, carrier) VALUES ($1, $2, $3, $4) RETURNING id`,
    [analysis.id, analysis.contract_document_id, firstRate?.contractNumber ?? null, firstRate?.carrier ?? null],
  );
  const contractId = contractRows[0]!.id;
  for (const r of extracted.rates) await insertRate(client, contractId, r);

  // Invoice + lines
  const { rows: invoiceRows } = await client.query<{ id: string }>(
    `INSERT INTO invoices (analysis_id, document_id, invoice_number, carrier, shipment_id, invoice_date, shipment_date,
                           currency, origin, destination, route, container_type, total_minor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [
      analysis.id, analysis.invoice_document_id, inv.invoiceNumber, inv.carrier, inv.shipmentId, inv.invoiceDate,
      inv.shipmentDate, inv.currency, inv.origin, inv.destination, inv.route, inv.containerType, inv.totalMinor,
    ],
  );
  const invoiceId = invoiceRows[0]!.id;
  const lineIds = new Map<string, string>();
  for (const line of inv.lines) lineIds.set(line.id, await insertLine(client, invoiceId, line));

  for (const d of audit.discrepancies) await insertRateDiscrepancy(client, analysis.id, invoiceId, lineIds.get(d.invoiceLineId) ?? null, d);

  const duplicates = await findDuplicates(invoiceId);
  for (const dup of duplicates) await insertDuplicateDiscrepancy(client, analysis.id, invoiceId, lineIds.get(dup.invoiceLineRef) ?? null, dup);

  const status: Status = audit.status === "NEEDS_REVIEW" || duplicates.length > 0 ? "NEEDS_REVIEW" : "COMPLETED";
  await client.query(
    `UPDATE analyses SET status = $2, stage = NULL, extraction_method = $3, model = $4, extracted = $5, audit = $6,
            completed_at = now(), updated_at = now()
     WHERE id = $1`,
    [analysis.id, status, extracted.meta.method, extracted.meta.model ?? null, JSON.stringify(extracted), JSON.stringify(audit)],
  );
  return { status, duplicates };
}

async function insertRate(client: DbClient, contractId: string, r: ContractRate): Promise<void> {
  await client.query(
    `INSERT INTO contract_rates (contract_id, rate_ref, origin, destination, route, container_type, charge_type, charge_label,
                                 unit_rate_minor, rate_basis, currency, valid_from, valid_to, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      contractId, r.id, r.origin, r.destination, r.route, r.containerType, r.chargeType, r.chargeLabel,
      r.unitRateMinor, r.rateBasis, r.currency, r.validFrom, r.validTo, JSON.stringify(r.source),
    ],
  );
}

export async function insertLine(client: DbClient, invoiceId: string, line: InvoiceLine): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO invoice_lines (invoice_id, line_ref, line_number, description, charge_type, charge_label, quantity,
                                unit_price_minor, amount_minor, currency, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      invoiceId, line.id, line.lineNumber, line.description, line.chargeType, line.chargeLabel, line.quantity,
      line.unitPriceMinor, line.amountMinor, line.currency, JSON.stringify(line.source),
    ],
  );
  return rows[0]!.id;
}

async function insertRateDiscrepancy(client: DbClient, analysisId: string, invoiceId: string, lineId: string | null, d: VerifiedDiscrepancy): Promise<void> {
  await client.query(
    `INSERT INTO discrepancies (analysis_id, invoice_id, invoice_line_id, engine_id, type, status, invoice_number, shipment_id,
                                carrier, currency, billed_amount_minor, expected_amount_minor, difference_minor, calculation,
                                explanation, evidence, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      analysisId, invoiceId, lineId, d.id, d.type, d.status, d.invoiceNumber, d.shipmentId, d.carrier, d.currency,
      d.billedAmountMinor, d.expectedAmountMinor, d.differenceMinor, d.calculation, d.explanation,
      JSON.stringify(
        d.type === "RATE_MISMATCH"
          ? { invoiceEvidence: d.invoiceEvidence, contractEvidence: d.contractEvidence, matchCriteria: d.matchCriteria, calculation: d.calculation, explanation: d.explanation }
          : { invoiceEvidence: d.invoiceEvidence, originalEvidence: d.originalEvidence, original: d.original, duplicateCriteria: d.duplicateCriteria, calculation: d.calculation, explanation: d.explanation },
      ),
      JSON.stringify(d),
    ],
  );
}

async function insertDuplicateDiscrepancy(client: DbClient, analysisId: string, invoiceId: string, lineId: string | null, dup: DuplicateFinding): Promise<void> {
  await client.query(
    `INSERT INTO discrepancies (analysis_id, invoice_id, invoice_line_id, engine_id, type, status, invoice_number, shipment_id,
                                carrier, currency, billed_amount_minor, expected_amount_minor, difference_minor, calculation,
                                explanation, evidence, payload)
     VALUES ($1, $2, $3, $4, 'DUPLICATE_BILLING', 'NEEDS_REVIEW', $5, $6, $7, $8, $9, 0, $9, $10, $11, $12, $13)`,
    [
      analysisId, invoiceId, lineId, `${dup.invoiceLineRef}:DUPLICATE_BILLING`, dup.invoiceNumber, dup.shipmentId, dup.carrier,
      dup.currency, dup.amountMinor, dup.calculation, dup.explanation,
      JSON.stringify({ invoiceEvidence: dup.invoiceEvidence, previousInvoiceEvidence: dup.previousEvidence, previousInvoice: dup.previous, calculation: dup.calculation, explanation: dup.explanation }),
      JSON.stringify(dup),
    ],
  );
}

// ---------------------------------------------------------------------------
// Discrepancies & claims
// ---------------------------------------------------------------------------

export type DiscrepancyRow = {
  id: string;
  analysis_id: string;
  invoice_id: string | null;
  invoice_line_id: string | null;
  engine_id: string;
  type: DiscrepancyType;
  status: "VERIFIED" | "NEEDS_REVIEW";
  invoice_number: string | null;
  shipment_id: string | null;
  carrier: string | null;
  currency: string | null;
  billed_amount_minor: number | null;
  expected_amount_minor: number | null;
  difference_minor: number | null;
  calculation: string | null;
  explanation: string | null;
  evidence: Record<string, unknown>;
  payload: Record<string, unknown>;
  created_at: Date;
  claim_count?: number;
  latest_claim_id?: string | null;
};

const DISCREPANCY_SELECT = `
  SELECT d.*,
         (SELECT count(*)::int FROM claims c WHERE c.discrepancy_id = d.id) AS claim_count,
         (SELECT c.id FROM claims c WHERE c.discrepancy_id = d.id ORDER BY c.created_at DESC LIMIT 1) AS latest_claim_id
  FROM discrepancies d`;

export async function listDiscrepancies(db: DbClient, filter: { analysisId?: string; type?: string; status?: string; limit?: number }): Promise<DiscrepancyRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.analysisId) where.push(`d.analysis_id = $${params.push(filter.analysisId)}`);
  if (filter.type) where.push(`d.type = $${params.push(filter.type)}`);
  if (filter.status) where.push(`d.status = $${params.push(filter.status)}`);
  const { rows } = await db.query<DiscrepancyRow>(
    `${DISCREPANCY_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY d.created_at DESC LIMIT $${params.push(filter.limit ?? 100)}`,
    params,
  );
  return rows;
}

export async function getDiscrepancy(db: DbClient, id: string): Promise<DiscrepancyRow | null> {
  const { rows } = await db.query<DiscrepancyRow>(`${DISCREPANCY_SELECT} WHERE d.id = $1`, [id]);
  return rows[0] ?? null;
}

export function discrepancyDto(row: DiscrepancyRow) {
  return {
    id: row.id,
    engineId: row.engine_id,
    analysisId: row.analysis_id,
    type: row.type,
    status: row.status,
    claimable: row.type === "RATE_MISMATCH" && row.status === "VERIFIED",
    invoiceNumber: row.invoice_number,
    shipmentId: row.shipment_id,
    carrier: row.carrier,
    currency: row.currency,
    billedAmountMinor: row.billed_amount_minor,
    expectedAmountMinor: row.expected_amount_minor,
    differenceMinor: row.difference_minor,
    calculation: row.calculation,
    explanation: row.explanation,
    evidence: row.evidence,
    claimCount: row.claim_count ?? 0,
    latestClaimId: row.latest_claim_id ?? null,
    createdAt: row.created_at,
  };
}

export type ClaimRow = {
  id: string;
  discrepancy_id: string;
  status: string;
  generated_by: "AI" | "TEMPLATE";
  model: string | null;
  subject: string;
  body: string;
  rendered_text: string;
  disputed_amount_minor: number;
  currency: string;
  payload: RecoveryClaim;
  created_at: Date;
};

export async function insertClaim(db: DbClient, discrepancyId: string, claim: RecoveryClaim, renderedText: string): Promise<ClaimRow> {
  const { rows } = await db.query<ClaimRow>(
    `INSERT INTO claims (discrepancy_id, status, generated_by, model, subject, body, rendered_text, disputed_amount_minor, currency, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [discrepancyId, claim.status, claim.generatedBy, claim.model ?? null, claim.subject, claim.body, renderedText, claim.disputedAmountMinor, claim.currency, JSON.stringify(claim)],
  );
  return rows[0]!;
}

export async function getLatestClaim(db: DbClient, discrepancyId: string): Promise<ClaimRow | null> {
  const { rows } = await db.query<ClaimRow>("SELECT * FROM claims WHERE discrepancy_id = $1 ORDER BY created_at DESC LIMIT 1", [discrepancyId]);
  return rows[0] ?? null;
}

export async function getClaim(db: DbClient, id: string): Promise<ClaimRow | null> {
  const { rows } = await db.query<ClaimRow>("SELECT * FROM claims WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export function claimDto(row: ClaimRow) {
  return {
    id: row.id,
    discrepancyId: row.discrepancy_id,
    status: row.status,
    requiresHumanApproval: true,
    generatedBy: row.generated_by,
    model: row.model,
    subject: row.subject,
    body: row.body,
    text: row.rendered_text,
    disputedAmountMinor: row.disputed_amount_minor,
    currency: row.currency,
    invoiceNumber: row.payload.invoiceNumber,
    shipmentId: row.payload.shipmentId,
    evidence: row.payload.evidence,
    warnings: row.payload.warnings,
    createdAt: row.created_at,
    downloadUrl: `/api/claims/${row.id}/download`,
  };
}
