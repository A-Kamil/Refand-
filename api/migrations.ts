import type { Db } from "./db.js";

/** Ordered, append-only migrations. Never edit a migration once deployed; add a new one. */
export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: "001_initial_schema",
    sql: `
CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('INVOICE', 'CONTRACT')),
  filename      text NOT NULL,
  mime_type     text,
  size_bytes    integer NOT NULL,
  sha256        text NOT NULL,
  format        text CHECK (format IN ('PDF', 'CSV', 'TEXT')),
  page_count    integer,
  pages         jsonb,
  warnings      jsonb NOT NULL DEFAULT '[]',
  content       bytea NOT NULL,
  status        text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED')),
  error         jsonb,
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_sha256_idx ON documents (sha256);

CREATE TABLE analyses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_document_id  uuid NOT NULL REFERENCES documents (id),
  contract_document_id uuid NOT NULL REFERENCES documents (id),
  status               text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED')),
  stage                text,
  stage_history        jsonb NOT NULL DEFAULT '[]',
  extraction_method    text CHECK (extraction_method IN ('AI', 'FIXTURE')),
  requested_mode       text NOT NULL CHECK (requested_mode IN ('AI', 'FIXTURE')),
  model                text,
  extracted            jsonb,
  audit                jsonb,
  error                jsonb,
  started_at           timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analyses_created_at_idx ON analyses (created_at DESC);

CREATE TABLE contracts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     uuid REFERENCES analyses (id) ON DELETE CASCADE,
  document_id     uuid REFERENCES documents (id),
  contract_number text,
  carrier         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contract_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     uuid NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
  rate_ref        text NOT NULL,
  origin          text,
  destination     text,
  route           text,
  container_type  text,
  charge_type     text NOT NULL,
  charge_label    text NOT NULL,
  unit_rate_minor bigint,
  rate_basis      text,
  currency        text,
  valid_from      date,
  valid_to        date,
  source          jsonb NOT NULL
);

CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id    uuid REFERENCES analyses (id) ON DELETE CASCADE,
  document_id    uuid REFERENCES documents (id),
  origin_kind    text NOT NULL DEFAULT 'ANALYSIS' CHECK (origin_kind IN ('ANALYSIS', 'SEED')),
  invoice_number text,
  carrier        text,
  shipment_id    text,
  invoice_date   date,
  shipment_date  date,
  currency       text,
  origin         text,
  destination    text,
  route          text,
  container_type text,
  total_minor    bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_shipment_idx ON invoices (shipment_id);
CREATE INDEX invoices_number_idx ON invoices (invoice_number);

CREATE TABLE invoice_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  line_ref         text NOT NULL,
  line_number      integer,
  description      text NOT NULL,
  charge_type      text NOT NULL,
  charge_label     text NOT NULL,
  quantity         numeric,
  unit_price_minor bigint,
  amount_minor     bigint,
  currency         text,
  source           jsonb NOT NULL
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id);

CREATE TABLE discrepancies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id           uuid NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  invoice_id            uuid REFERENCES invoices (id) ON DELETE CASCADE,
  invoice_line_id       uuid REFERENCES invoice_lines (id) ON DELETE CASCADE,
  engine_id             text NOT NULL,
  type                  text NOT NULL CHECK (type IN ('RATE_MISMATCH', 'DUPLICATE_BILLING')),
  status                text NOT NULL CHECK (status IN ('VERIFIED', 'NEEDS_REVIEW')),
  invoice_number        text,
  shipment_id           text,
  carrier               text,
  currency              text,
  billed_amount_minor   bigint,
  expected_amount_minor bigint,
  difference_minor      bigint,
  calculation           text,
  explanation           text,
  evidence              jsonb NOT NULL,
  payload               jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX discrepancies_analysis_idx ON discrepancies (analysis_id);
CREATE INDEX discrepancies_engine_id_idx ON discrepancies (engine_id);

CREATE TABLE claims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discrepancy_id        uuid NOT NULL REFERENCES discrepancies (id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'DRAFT',
  generated_by          text NOT NULL CHECK (generated_by IN ('AI', 'TEMPLATE')),
  model                 text,
  subject               text NOT NULL,
  body                  text NOT NULL,
  rendered_text         text NOT NULL,
  disputed_amount_minor bigint NOT NULL,
  currency              text NOT NULL,
  payload               jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claims_discrepancy_idx ON claims (discrepancy_id, created_at DESC);
`,
  },
];

const LOCK_KEY = 4_242_017; // pg_advisory_lock key shared by every instance of this API

/** Applies pending migrations in order, each in its own transaction, under an advisory lock. */
export async function migrate(db: Db, log: (msg: string) => void = () => undefined): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await client.query<{ id: string }>("SELECT id FROM schema_migrations");
    const done = new Set(rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      applied.push(m.id);
      log(`migration applied: ${m.id}`);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
