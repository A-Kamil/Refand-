import type { Db } from "./db.js";
import { discrepancyDto, type DiscrepancyRow } from "./repository.js";

/** Illustrative enterprise portfolio for the demo. Never mixed with figures computed by the MVP. */
const SIMULATED_PORTFOLIO = {
  simulated: true,
  label: "Simulated enterprise portfolio. Illustrative figures, not computed by this MVP.",
  currency: "EUR",
  annualFreightSpendMinor: 12_500_000_000,
  potentiallyRecoverableMinor: 320_000_000,
  invoicesAnalyzed: 48_250,
  anomaliesIdentified: 1_842,
  byCategory: [
    { type: "RATE_MISMATCH", label: "Contract rate overcharge", count: 1_020, amountMinor: 195_000_000 },
    { type: "DUPLICATE_BILLING", label: "Duplicate billing", count: 412, amountMinor: 78_000_000 },
    { type: "UNJUSTIFIED_SURCHARGE", label: "Unjustified surcharges", count: 410, amountMinor: 47_000_000 },
  ],
  byStatus: [
    { status: "DETECTED", count: 1_104 },
    { status: "CLAIM_SENT", count: 498 },
    { status: "RECOVERED", count: 240 },
  ],
};

/**
 * Live figures are computed from PostgreSQL. Re-running the same invoice produces the same
 * engine id, so totals count each distinct discrepancy once (its latest occurrence).
 */
export async function getDashboard(db: Db) {
  const [analyses, byType, claims, invoices, recent] = await Promise.all([
    db.query<{ status: string; count: number }>("SELECT status, count(*)::int AS count FROM analyses GROUP BY status"),
    db.query<{ type: string; status: string; count: number; amount_minor: number }>(
      `SELECT type, status, count(*)::int AS count, COALESCE(sum(difference_minor), 0) AS amount_minor
       FROM (SELECT DISTINCT ON (engine_id) * FROM discrepancies ORDER BY engine_id, created_at DESC) d
       GROUP BY type, status`,
    ),
    db.query<{ total: number; ai: number; template: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE generated_by = 'AI')::int AS ai,
              count(*) FILTER (WHERE generated_by = 'TEMPLATE')::int AS template FROM claims`,
    ),
    db.query<{ analyzed: number; stored: number }>(
      `SELECT count(DISTINCT invoice_number) FILTER (WHERE origin_kind = 'ANALYSIS')::int AS analyzed, count(*)::int AS stored FROM invoices`,
    ),
    db.query<DiscrepancyRow>(
      `SELECT d.*, (SELECT count(*)::int FROM claims c WHERE c.discrepancy_id = d.id) AS claim_count,
              (SELECT c.id FROM claims c WHERE c.discrepancy_id = d.id ORDER BY c.created_at DESC LIMIT 1) AS latest_claim_id
       FROM discrepancies d ORDER BY d.created_at DESC LIMIT 10`,
    ),
  ]);

  const types = byType.rows;
  const sum = (rows: typeof types) => rows.reduce((s, r) => s + Number(r.amount_minor), 0);
  const count = (rows: typeof types) => rows.reduce((s, r) => s + r.count, 0);
  const verified = types.filter((r) => r.status === "VERIFIED");
  const review = types.filter((r) => r.status === "NEEDS_REVIEW");

  return {
    simulatedPortfolio: SIMULATED_PORTFOLIO,
    live: {
      simulated: false,
      label: "Computed by FreightRecover AI from documents analysed on this deployment.",
      currency: "EUR",
      analyses: {
        total: analyses.rows.reduce((s, r) => s + r.count, 0),
        byStatus: Object.fromEntries(analyses.rows.map((r) => [r.status, r.count])),
      },
      invoicesAnalyzed: invoices.rows[0]?.analyzed ?? 0,
      invoicesStored: invoices.rows[0]?.stored ?? 0,
      discrepancies: {
        total: count(types),
        verified: count(verified),
        needsReview: count(review),
        byType: ["RATE_MISMATCH", "DUPLICATE_BILLING"].map((type) => {
          const rows = types.filter((r) => r.type === type);
          return { type, count: count(rows), amountMinor: sum(rows) };
        }),
      },
      verifiedRecoverableMinor: sum(verified),
      potentialToReviewMinor: sum(review),
      claims: claims.rows[0] ?? { total: 0, ai: 0, template: 0 },
      recentDiscrepancies: recent.rows.map(discrepancyDto),
    },
  };
}
