import { createWriteStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));

type Job = { source: string; target: string; title: string; pageBreakBefore?: string };

const jobs: Job[] = [
  { source: "invoice-sample.txt", target: "invoice-sample.pdf", title: "FR-2026-0842 Freight Invoice" },
  { source: "invoice-duplicate-sample.txt", target: "invoice-duplicate-sample.pdf", title: "FR-2026-0907 Freight Invoice" },
  {
    source: "contract-sample.txt",
    target: "contract-sample.pdf",
    title: "AOL-SVC-2026-017 Service Agreement",
    pageBreakBefore: "Clause 4 - Rate Schedule",
  },
];

const MARGIN = 50;
const LINE_GAP = 4;

function render(job: Job): Promise<void> {
  const lines = readFileSync(fixturesDir + job.source, "utf8").replace(/\r\n?/gu, "\n").trimEnd().split("\n");
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: { Title: job.title, Producer: "FreightRecover AI fixtures", Creator: "FreightRecover AI fixtures", CreationDate: new Date(Date.UTC(2026, 0, 1)) },
  });
  const done = new Promise<void>((resolve, reject) => {
    const out = createWriteStream(fixturesDir + job.target);
    out.on("finish", resolve);
    out.on("error", reject);
    doc.pipe(out);
  });
  const width = doc.page.width - MARGIN * 2;
  lines.forEach((line, index) => {
    if (job.pageBreakBefore && line.trim() === job.pageBreakBefore) doc.addPage();
    if (line.trim() === "") {
      doc.moveDown(0.6);
      return;
    }
    doc.font(index === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(index === 0 ? 12 : 10);
    doc.text(line, MARGIN, doc.y, { width, lineGap: LINE_GAP });
  });
  doc.end();
  return done;
}

for (const job of jobs) {
  await render(job);
  console.log(`wrote fixtures/${job.target}`);
}
