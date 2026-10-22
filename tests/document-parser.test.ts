import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { EngineError } from "../src/errors.js";
import { MAX_DOCUMENT_BYTES, parseDocument } from "../src/services/document-parser.js";
import { collapseWhitespace } from "../src/services/normalization.js";
import type { DocumentKind } from "../src/types/shared.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const INVOICE_LINE = "1 | Ocean Freight | Shanghai (CNSHA) to Rotterdam (NLRTM) | 40HC | 1 | EUR 42,500.00 | EUR 42,500.00";
const RATE_LINE = "4.2.1 Ocean Freight | Shanghai (CNSHA) to Rotterdam (NLRTM) | 40HC | EUR 24,000.00 per container";

function parse(filename: string, content: Uint8Array, kind: DocumentKind = "INVOICE", mimeType?: string) {
  return parseDocument({ documentId: "doc-1", filename, kind, content, mimeType });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(EngineError);
  expect((error as EngineError).code).toBe(code);
  return error as EngineError;
}

function blankPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.rect(50, 50, 300, 200).fill("#888888");
    doc.addPage().rect(50, 50, 300, 200).fill("#444444");
    doc.end();
  });
}

describe("parseDocument", () => {
  it("parses the invoice PDF and round-trips the charge line", async () => {
    const doc = await parse("invoice-sample.pdf", fixture("invoice-sample.pdf"));
    expect(doc.format).toBe("PDF");
    expect(doc.pageNumbered).toBe(true);
    expect(doc.pages).toHaveLength(1);
    expect(doc.warnings).toEqual([]);
    expect(collapseWhitespace(doc.text)).toContain(INVOICE_LINE);
    expect(doc.text).toBe(doc.pages.join("\n\n"));
  });

  it("parses the contract PDF across two pages with the rate on page 2", async () => {
    const doc = await parse("contract-sample.pdf", fixture("contract-sample.pdf"), "CONTRACT");
    expect(doc.pages).toHaveLength(2);
    expect(collapseWhitespace(doc.pages[0]!)).not.toContain(RATE_LINE);
    expect(collapseWhitespace(doc.pages[1]!)).toContain(RATE_LINE);
    expect(collapseWhitespace(doc.pages[1]!)).toContain("Clause 4 - Rate Schedule");
  });

  it("detects PDF by magic bytes regardless of extension", async () => {
    const doc = await parse("upload.bin", fixture("invoice-sample.pdf"));
    expect(doc.format).toBe("PDF");
  });

  it("keeps the original CSV text verbatim", async () => {
    const raw = fixture("invoice-sample.csv");
    const doc = await parse("invoice-sample.csv", raw);
    expect(doc.format).toBe("CSV");
    expect(doc.pageNumbered).toBe(false);
    expect(doc.pages).toEqual([raw.toString("utf8").replace(/\r\n?/gu, "\n")]);
    expect(doc.text).toContain("FR-2026-0842,2026-10-20,Atlantic Ocean Lines");
  });

  it("detects CSV by mime type and strips a BOM", async () => {
    const doc = await parse("upload", Buffer.from("﻿a,b\r\n1,2\r\n"), "INVOICE", "text/csv; charset=utf-8");
    expect(doc.format).toBe("CSV");
    expect(doc.text).toBe("a,b\n1,2\n");
  });

  it("rejects a CSV without data rows", async () => {
    await expectCode(parse("x.csv", Buffer.from("a,b\n")), "UNREADABLE_DOCUMENT");
  });

  it("parses the plain-text fixture", async () => {
    const doc = await parse("contract-sample.txt", fixture("contract-sample.txt"), "CONTRACT");
    expect(doc.format).toBe("TEXT");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pageNumbered).toBe(false);
    expect(collapseWhitespace(doc.text)).toContain(RATE_LINE);
  });

  it("rejects empty and whitespace-only documents", async () => {
    await expectCode(parse("x.txt", new Uint8Array()), "EMPTY_DOCUMENT");
    await expectCode(parse("x.txt", Buffer.from(" \n\t\n")), "EMPTY_DOCUMENT");
  });

  it("rejects oversized documents", async () => {
    await expectCode(parse("x.txt", new Uint8Array(MAX_DOCUMENT_BYTES + 1)), "DOCUMENT_TOO_LARGE");
  });

  it("rejects unsupported formats", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await expectCode(parse("scan.png", png, "INVOICE", "image/png"), "UNSUPPORTED_FORMAT");
  });

  it("rejects binary content posing as text", async () => {
    await expectCode(parse("x.txt", Uint8Array.from([0x41, 0x00, 0x42])), "UNREADABLE_DOCUMENT");
  });

  it("rejects corrupt PDFs", async () => {
    await expectCode(parse("x.pdf", Buffer.from("%PDF-garbage")), "UNREADABLE_DOCUMENT");
  });

  it("rejects image-only PDFs as scanned", async () => {
    const error = await expectCode(parse("scan.pdf", await blankPdf()), "SCANNED_PDF");
    expect(error.message).toMatch(/OCR is not supported/u);
  });

  it("rejects CSV contracts", async () => {
    await expectCode(parse("rates.csv", Buffer.from("a,b\n1,2\n"), "CONTRACT"), "UNSUPPORTED_FORMAT");
  });
});
