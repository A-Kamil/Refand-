import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { extractText, getDocumentProxy } from "unpdf";
import { EngineError } from "../errors.js";
import type { DocumentFormat, DocumentKind, ParsedDocument } from "../types/shared.js";

/** Upload size limit (10 MB). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Below this average of non-whitespace characters per page, a PDF is treated as scanned. */
const MIN_CHARS_PER_PAGE = 20;
/** Pages with fewer non-whitespace characters than this get a warning. */
const NEAR_EMPTY_PAGE_CHARS = 5;

export type ParseDocumentInput = {
  documentId: string;
  filename: string;
  kind: DocumentKind;
  content: Uint8Array | Buffer;
  mimeType?: string;
};

export async function parseDocument(input: ParseDocumentInput): Promise<ParsedDocument> {
  const bytes = new Uint8Array(input.content);
  if (bytes.length === 0) throw new EngineError("EMPTY_DOCUMENT", `"${input.filename}" is empty.`);
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new EngineError(
      "DOCUMENT_TOO_LARGE",
      `"${input.filename}" is ${bytes.length} bytes; the limit is ${MAX_DOCUMENT_BYTES} bytes.`,
      { size: bytes.length, limit: MAX_DOCUMENT_BYTES },
    );
  }

  const format = detectFormat(bytes, input.filename, input.mimeType);
  if (!format) {
    throw new EngineError("UNSUPPORTED_FORMAT", `"${input.filename}" is not a supported format (PDF, CSV or plain text).`);
  }
  if (input.kind === "CONTRACT" && format === "CSV") {
    throw new EngineError("UNSUPPORTED_FORMAT", `Contracts must be PDF or plain text; "${input.filename}" is CSV.`);
  }

  const warnings: string[] = [];
  const pages =
    format === "PDF" ? await readPdf(bytes, input.filename, warnings)
    : format === "CSV" ? [readCsv(bytes, input.filename)]
    : [readText(bytes, input.filename)];

  return {
    documentId: input.documentId,
    filename: input.filename,
    kind: input.kind,
    format,
    pages,
    text: pages.join("\n\n"),
    pageNumbered: format === "PDF",
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    warnings,
  };
}

function detectFormat(bytes: Uint8Array, filename: string, mimeType?: string): DocumentFormat | null {
  if (startsWith(bytes, "%PDF-")) return "PDF";
  const name = filename.toLowerCase();
  const mime = (mimeType ?? "").toLowerCase().split(";")[0]!.trim();
  if (name.endsWith(".csv") || mime === "text/csv") return "CSV";
  if (name.endsWith(".txt") || mime === "text/plain") return "TEXT";
  return null;
}

function startsWith(bytes: Uint8Array, prefix: string): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix.charCodeAt(i)) return false;
  return true;
}

async function readPdf(bytes: Uint8Array, filename: string, warnings: string[]): Promise<string[]> {
  let pages: string[];
  try {
    // pdf.js may transfer the buffer, so hand it a copy.
    const pdf = await getDocumentProxy(bytes.slice());
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch (error) {
    throw new EngineError("UNREADABLE_DOCUMENT", `"${filename}" could not be read as a PDF.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (pages.length === 0) throw new EngineError("UNREADABLE_DOCUMENT", `"${filename}" has no pages.`);

  pages = pages.map(normalizeLineEndings);
  const counts = pages.map(nonWhitespaceLength);
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total / pages.length < MIN_CHARS_PER_PAGE) {
    throw new EngineError(
      "SCANNED_PDF",
      `"${filename}" has almost no extractable text; it looks like a scanned or image-only PDF. OCR is not supported — upload a text-based PDF, CSV or plain text file.`,
      { pages: pages.length, characters: total },
    );
  }
  counts.forEach((n, i) => {
    if (n < NEAR_EMPTY_PAGE_CHARS) warnings.push(`Page ${i + 1} of "${filename}" has little or no extractable text.`);
  });
  return pages;
}

function readCsv(bytes: Uint8Array, filename: string): string {
  const text = decodeText(bytes, filename);
  let records: unknown[];
  try {
    records = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true }) as unknown[];
  } catch (error) {
    throw new EngineError("UNREADABLE_DOCUMENT", `"${filename}" is not valid CSV.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (records.length === 0) {
    throw new EngineError("UNREADABLE_DOCUMENT", `"${filename}" needs a header row and at least one data row.`);
  }
  return text;
}

function readText(bytes: Uint8Array, filename: string): string {
  return decodeText(bytes, filename);
}

function decodeText(bytes: Uint8Array, filename: string): string {
  if (bytes.includes(0)) throw new EngineError("UNREADABLE_DOCUMENT", `"${filename}" looks like a binary file, not text.`);
  const text = normalizeLineEndings(new TextDecoder("utf-8").decode(bytes).replace(/^﻿/u, ""));
  if (text.trim().length === 0) throw new EngineError("EMPTY_DOCUMENT", `"${filename}" contains no text.`);
  return text;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function nonWhitespaceLength(value: string): number {
  return value.replace(/\s+/gu, "").length;
}
