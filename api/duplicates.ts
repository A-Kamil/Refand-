import { formatMinor, type DocumentSource } from "../src/index.js";
import type { DbClient } from "./db.js";
import type { DuplicateFinding } from "./repository.js";

type Row = {
  line_ref: string;
  line_number: number | null;
  charge_label: string;
  amount_minor: number;
  currency: string | null;
  quantity: number | null;
  new_source: DocumentSource;
  invoice_number: string | null;
  shipment_id: string;
  carrier: string;
  prev_source: DocumentSource;
  prev_line_number: number | null;
  prev_invoice_id: string;
  prev_invoice_number: string | null;
  prev_document_id: string | null;
  prev_filename: string | null;
  prev_analysis_id: string | null;
  prev_invoice_date: string | null;
  match_count: number;
};

/**
 * Deterministic duplicate-billing check against every invoice already stored in PostgreSQL.
 * A line is a potential duplicate when another stored invoice from the same carrier, for the same
 * shipment, bills the same charge type for the same amount and currency. Re-analysing the exact same
 * file (same SHA-256) is not a duplicate. Findings are NEEDS_REVIEW: only a payment check can confirm them.
 */
export async function findDuplicateLines(client: DbClient, invoiceId: string): Promise<DuplicateFinding[]> {
  const { rows } = await client.query<Row>(
    `SELECT * FROM (
       SELECT nl.line_ref, nl.line_number, nl.charge_label, nl.amount_minor, nl.currency, nl.quantity, nl.source AS new_source,
              ni.invoice_number, ni.shipment_id, ni.carrier,
              pl.source AS prev_source, pl.line_number AS prev_line_number,
              pi.id AS prev_invoice_id, pi.invoice_number AS prev_invoice_number, pi.document_id AS prev_document_id,
              pd.filename AS prev_filename, pi.analysis_id AS prev_analysis_id, pi.invoice_date AS prev_invoice_date,
              count(*) OVER (PARTITION BY nl.id)::int AS match_count,
              row_number() OVER (PARTITION BY nl.id ORDER BY pi.created_at, pi.id) AS rn
       FROM invoice_lines nl
       JOIN invoices ni ON ni.id = nl.invoice_id
       LEFT JOIN documents nd ON nd.id = ni.document_id
       JOIN invoices pi ON pi.id <> ni.id
                       AND pi.shipment_id = ni.shipment_id
                       AND lower(pi.carrier) = lower(ni.carrier)
       JOIN invoice_lines pl ON pl.invoice_id = pi.id
                            AND pl.charge_type = nl.charge_type
                            AND pl.amount_minor = nl.amount_minor
                            AND pl.currency IS NOT DISTINCT FROM nl.currency
       LEFT JOIN documents pd ON pd.id = pi.document_id
       WHERE nl.invoice_id = $1
         AND nl.amount_minor > 0
         AND ni.shipment_id IS NOT NULL
         AND ni.carrier IS NOT NULL
         AND (pd.sha256 IS NULL OR nd.sha256 IS NULL OR pd.sha256 <> nd.sha256)
     ) m
     WHERE m.rn = 1`,
    [invoiceId],
  );

  return rows.map((r) => {
    const currency = r.currency ?? "EUR";
    const amount = formatMinor(r.amount_minor, currency);
    const current = r.invoice_number ?? "this invoice";
    const previous = r.prev_invoice_number ?? "a previous invoice";
    const prevWhere = r.prev_filename ? ` (${r.prev_filename})` : "";
    const sameNumber = r.invoice_number !== null && r.invoice_number === r.prev_invoice_number;
    const others = r.match_count > 1 ? ` It matches ${r.match_count} stored invoices; the earliest is shown.` : "";
    const explanation = sameNumber
      ? `Invoice ${current} was already received as another document${prevWhere}. Its ${r.charge_label} line of ${amount} for shipment ${r.shipment_id} appears on both. Potential duplicate: confirm whether it was paid twice before requesting a refund.${others}`
      : `Shipment ${r.shipment_id} (${r.carrier}): the ${r.charge_label} charge of ${amount} on ${current} was already billed on ${previous}${prevWhere}${r.prev_invoice_date ? ` dated ${r.prev_invoice_date}` : ""}. Potential duplicate: confirm whether both invoices were paid before requesting a refund.${others}`;
    return {
      invoiceLineRef: r.line_ref,
      amountMinor: r.amount_minor,
      currency,
      quantity: r.quantity,
      invoiceNumber: current,
      shipmentId: r.shipment_id,
      carrier: r.carrier,
      calculation: `${current} line ${r.line_number ?? "?"} (${amount}) = ${previous} line ${r.prev_line_number ?? "?"} (${amount}) → potential duplicate ${amount}`,
      explanation,
      invoiceEvidence: r.new_source,
      previousEvidence: r.prev_source,
      previous: {
        invoiceId: r.prev_invoice_id,
        invoiceNumber: r.prev_invoice_number,
        documentId: r.prev_document_id,
        filename: r.prev_filename,
        analysisId: r.prev_analysis_id,
        invoiceDate: r.prev_invoice_date,
        matchCount: r.match_count,
      },
    };
  });
}
