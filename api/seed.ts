import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument, type InvoiceLine } from "../src/index.js";
import { withTransaction, type Db } from "./db.js";
import { DEMO_DOCUMENTS, sha256 } from "./fixtures.js";
import { insertDocument, insertLine } from "./repository.js";

type SeedInvoice = {
  id: string;
  invoiceNumber: string;
  carrier: string;
  shipmentId: string;
  invoiceDate: string;
  shipmentDate: string;
  origin: string;
  destination: string;
  containerType: string;
  lines: Array<{ label: string; chargeType: InvoiceLine["chargeType"]; amountMinor: number }>;
};

/** Fictional, already-processed invoice history (no source file). Used for history and the duplicate check. */
const HISTORY: SeedInvoice[] = [
  {
    id: "00000000-0000-4000-9000-000000000688",
    invoiceNumber: "FR-2026-0688",
    carrier: "Atlantic Ocean Lines",
    shipmentId: "SHIP-00377",
    invoiceDate: "2026-07-20",
    shipmentDate: "2026-07-14",
    origin: "Shanghai (CNSHA)",
    destination: "Hamburg (DEHAM)",
    containerType: "40HC",
    lines: [{ label: "Ocean Freight", chargeType: "OCEAN_FREIGHT", amountMinor: 2_550_000 }],
  },
  {
    id: "00000000-0000-4000-9000-000000000731",
    invoiceNumber: "FR-2026-0731",
    carrier: "Atlantic Ocean Lines",
    shipmentId: "SHIP-00398",
    invoiceDate: "2026-08-28",
    shipmentDate: "2026-08-21",
    origin: "Shanghai (CNSHA)",
    destination: "Rotterdam (NLRTM)",
    containerType: "20GP",
    lines: [
      { label: "Ocean Freight", chargeType: "OCEAN_FREIGHT", amountMinor: 1_400_000 },
      { label: "Terminal Handling Charge - Destination", chargeType: "THC_DESTINATION", amountMinor: 28_000 },
    ],
  },
  {
    id: "00000000-0000-4000-9000-000000001192",
    invoiceNumber: "NSF-2026-1192",
    carrier: "Nordic Sea Freight",
    shipmentId: "SHIP-00402",
    invoiceDate: "2026-09-12",
    shipmentDate: "2026-09-05",
    origin: "Ningbo (CNNGB)",
    destination: "Antwerp (BEANR)",
    containerType: "40HC",
    lines: [
      { label: "Ocean Freight", chargeType: "OCEAN_FREIGHT", amountMinor: 2_380_000 },
      { label: "Documentation Fee", chargeType: "DOCUMENTATION", amountMinor: 7_500 },
    ],
  },
];

/** Idempotent: inserts the demo documents and the invoice history once, with stable ids. */
export async function seed(db: Db, fixturesDir: string): Promise<{ documents: number; invoices: number }> {
  let documents = 0;
  let invoices = 0;

  for (const d of DEMO_DOCUMENTS) {
    const exists = await db.query("SELECT 1 FROM documents WHERE id = $1", [d.id]);
    if (exists.rowCount) continue;
    let content: Buffer;
    try {
      content = await readFile(path.join(fixturesDir, d.file));
    } catch {
      continue; // fixtures not shipped with this build
    }
    const parsed = await parseDocument({ documentId: d.id, filename: d.file, kind: d.kind, content, mimeType: d.mimeType });
    await insertDocument(db, { id: d.id, kind: d.kind, filename: d.file, mimeType: d.mimeType, content, sha256: sha256(content), parsed, error: null, isDemo: true });
    documents++;
  }

  for (const inv of HISTORY) {
    const inserted = await withTransaction(db, async (client) => {
      const total = inv.lines.reduce((s, l) => s + l.amountMinor, 0);
      const { rowCount } = await client.query(
        `INSERT INTO invoices (id, origin_kind, invoice_number, carrier, shipment_id, invoice_date, shipment_date, currency,
                               origin, destination, route, container_type, total_minor)
         VALUES ($1, 'SEED', $2, $3, $4, $5, $6, 'EUR', $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
        [inv.id, inv.invoiceNumber, inv.carrier, inv.shipmentId, inv.invoiceDate, inv.shipmentDate, inv.origin, inv.destination, `${inv.origin} → ${inv.destination}`, inv.containerType, total],
      );
      if (!rowCount) return false;
      for (const [i, l] of inv.lines.entries()) {
        await insertLine(client, inv.id, {
          id: `${inv.invoiceNumber}#${i + 1}`,
          lineNumber: i + 1,
          description: l.label,
          chargeType: l.chargeType,
          chargeLabel: l.label,
          quantity: 1,
          unitPriceMinor: l.amountMinor,
          amountMinor: l.amountMinor,
          currency: "EUR",
          source: { documentId: "seed", filename: `${inv.invoiceNumber} (seeded history)`, excerpt: `${i + 1} | ${l.label} | 1 | EUR ${(l.amountMinor / 100).toFixed(2)}`, verified: false },
        });
      }
      return true;
    });
    if (inserted) invoices++;
  }
  return { documents, invoices };
}
