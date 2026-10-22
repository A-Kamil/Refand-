import type { ChargeType, RateBasis } from "../types/shared.js";

/**
 * Deterministic normalisation helpers. Only explicit, listed equivalences are applied:
 * two different ports or container types are never treated as equal by guesswork.
 */

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** NFKC, unify whitespace (incl. NBSP / narrow NBSP) and trim. Case is preserved. */
export function collapseWhitespace(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export type AmountParseResult =
  | { ok: true; minor: number }
  | { ok: false; reason: string };

/** Minor units per major unit. The MVP only verifies EUR; other 2-decimal codes parse identically. */
const MINOR_DIGITS = 2;

/**
 * Parses an amount as printed on a document into integer minor units (cents).
 * Accepts "EUR 42,500.00", "€42 500,00", "42.500,00", "42500", "1,234.5".
 * A single separator followed by exactly three digits ("42,500" / "42.500") is ambiguous
 * between thousands and decimals and is rejected rather than guessed.
 */
export function parseAmountToMinor(input: string): AmountParseResult {
  let text = collapseWhitespace(input)
    .replace(/(EUR|USD|GBP|CHF|€|\$|£)/giu, "")
    .replace(/[\s']/gu, "");
  let negative = false;
  if (/^\(.*\)$/u.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-") || text.startsWith("−")) {
    negative = true;
    text = text.slice(1);
  }
  if (text.length === 0) return { ok: false, reason: `No amount found in "${input}"` };
  if (!/^[0-9.,]+$/u.test(text)) return { ok: false, reason: `Unexpected characters in amount "${input}"` };

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let integerPart: string;
  let fractionPart = "";

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    const idx = text.lastIndexOf(decimalSep);
    integerPart = text.slice(0, idx);
    fractionPart = text.slice(idx + 1);
    if (integerPart.includes(decimalSep)) return { ok: false, reason: `Malformed amount "${input}"` };
    if (!isValidGrouping(integerPart, thousandsSep)) return { ok: false, reason: `Malformed thousands grouping in "${input}"` };
    integerPart = integerPart.split(thousandsSep).join("");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = text.split(sep);
    if (parts.length > 2) {
      if (!isValidGrouping(text, sep)) return { ok: false, reason: `Malformed thousands grouping in "${input}"` };
      integerPart = parts.join("");
    } else {
      const [head = "", tail = ""] = parts;
      if (tail.length === 3) {
        return { ok: false, reason: `Ambiguous separator in "${input}" (thousands or decimals)` };
      }
      integerPart = head;
      fractionPart = tail;
    }
  } else {
    integerPart = text;
  }

  if (!/^[0-9]+$/u.test(integerPart)) return { ok: false, reason: `Malformed amount "${input}"` };
  if (fractionPart !== "" && !/^[0-9]+$/u.test(fractionPart)) return { ok: false, reason: `Malformed amount "${input}"` };
  if (fractionPart.length > MINOR_DIGITS) {
    if (!/^0+$/u.test(fractionPart.slice(MINOR_DIGITS))) {
      return { ok: false, reason: `More than ${MINOR_DIGITS} decimals in "${input}"` };
    }
    fractionPart = fractionPart.slice(0, MINOR_DIGITS);
  }
  const minorText = integerPart + fractionPart.padEnd(MINOR_DIGITS, "0");
  const minor = Number(minorText);
  if (!Number.isSafeInteger(minor)) return { ok: false, reason: `Amount out of range in "${input}"` };
  return { ok: true, minor: negative ? -minor : minor };
}

function isValidGrouping(integerPart: string, sep: string): boolean {
  const groups = integerPart.split(sep);
  if (groups.length === 1) return /^[0-9]+$/u.test(integerPart);
  const [first = "", ...rest] = groups;
  return /^[0-9]{1,3}$/u.test(first) && rest.every((g) => /^[0-9]{3}$/u.test(g));
}

/** "EUR 18,500.00" — deterministic, locale-independent. */
export function formatMinor(minor: number, currency: string): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${negative ? "-" : ""}${currency} ${grouped}.${cents}`;
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

export function normalizeCurrency(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = collapseWhitespace(value).toUpperCase();
  if (v === "€" || v === "EUR" || v === "EURO" || v === "EUROS") return "EUR";
  if (v === "$" || v === "US$" || v === "USD") return "USD";
  if (v === "£" || v === "GBP") return "GBP";
  if (/^[A-Z]{3}$/u.test(v)) return v;
  return null;
}

// ---------------------------------------------------------------------------
// Carrier
// ---------------------------------------------------------------------------

const CARRIER_SUFFIXES = new Set([
  "ltd", "limited", "inc", "llc", "plc", "sa", "sas", "sarl", "gmbh", "ag", "bv", "nv", "as", "co", "company", "corp", "corporation",
]);

/** "ATLANTIC OCEAN LINES LTD." -> "atlantic ocean lines". */
export function normalizeCarrier(value: string | null | undefined): string | null {
  if (!value) return null;
  const words = collapseWhitespace(value)
    .toLowerCase()
    .replace(/[.,()&]/gu, " ")
    .split(" ")
    .filter((w) => w.length > 0);
  while (words.length > 1 && CARRIER_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.length > 0 ? words.join(" ") : null;
}

// ---------------------------------------------------------------------------
// Ports (UN/LOCODE)
// ---------------------------------------------------------------------------

/** Explicit port-name aliases. Ports absent from this list are compared by cleaned name only. */
const PORT_ALIASES: Record<string, string> = {
  SHANGHAI: "CNSHA",
  NINGBO: "CNNGB",
  SHENZHEN: "CNSZX",
  YANTIAN: "CNYTN",
  QINGDAO: "CNTAO",
  "HONG KONG": "HKHKG",
  SINGAPORE: "SGSIN",
  BUSAN: "KRPUS",
  ROTTERDAM: "NLRTM",
  HAMBURG: "DEHAM",
  BREMERHAVEN: "DEBRV",
  ANTWERP: "BEANR",
  ANTWERPEN: "BEANR",
  "LE HAVRE": "FRLEH",
  MARSEILLE: "FRMRS",
  "FOS SUR MER": "FRFOS",
  FELIXSTOWE: "GBFXT",
  VALENCIA: "ESVLC",
  ALGECIRAS: "ESALG",
  GENOA: "ITGOA",
  "NEW YORK": "USNYC",
  "LOS ANGELES": "USLAX",
};

const KNOWN_LOCODES = new Set(Object.values(PORT_ALIASES));

/**
 * "Shanghai (CNSHA)", "SHANGHAI", "CNSHA" -> "CNSHA".
 * An explicit LOCODE in parentheses wins; otherwise the alias table; otherwise the cleaned upper-case name.
 */
export function normalizePort(value: string | null | undefined): string | null {
  if (!value) return null;
  const upper = collapseWhitespace(value).toUpperCase();
  const inParens = upper.match(/\(([A-Z]{2}[A-Z2-9]{3})\)/u);
  if (inParens?.[1]) return inParens[1];
  if (/^[A-Z]{2}[A-Z2-9]{3}$/u.test(upper) && KNOWN_LOCODES.has(upper)) return upper;
  const name = upper
    .replace(/\(.*?\)/gu, " ")
    .replace(/[^A-Z ]/gu, " ")
    .replace(/\bPORT OF\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (name.length === 0) return null;
  return PORT_ALIASES[name] ?? name;
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/** Explicit container equivalences: 40HC = 40' HC = 40' High Cube = 40HQ, etc. */
export function normalizeContainerType(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = collapseWhitespace(value)
    .toUpperCase()
    .replace(/[’'"`\-\s]/gu, "")
    .replace(/FT|FOOT|FEET/gu, "");
  const m = v.match(/^(20|40|45)(.*)$/u);
  if (!m) return v.length > 0 ? v : null;
  const [, size, kind = ""] = m;
  if (["HC", "HQ", "HIGHCUBE", "HCDRY", "HIGHCUBEDRY"].includes(kind)) return `${size}HC`;
  if (["", "GP", "DV", "DC", "DRY", "ST", "STD", "STANDARD", "DRYVAN", "GENERALPURPOSE"].includes(kind)) {
    return size === "45" ? "45GP" : `${size}GP`;
  }
  if (["RF", "REEFER", "RH", "HR", "REEFERHC"].includes(kind)) return `${size}RF`;
  return `${size}${kind}`;
}

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

/** Classifies a charge label verbatim from the document. Unknown labels become "OTHER" (never matched to freight). */
export function normalizeChargeType(label: string | null | undefined): ChargeType {
  if (!label) return "OTHER";
  const l = collapseWhitespace(label).toLowerCase();
  if (/\bbaf\b|bunker|fuel surcharge/u.test(l)) return "BAF";
  if (/\bthc\b|terminal handling/u.test(l)) {
    if (/origin|export|\bpol\b|loading/u.test(l)) return "THC_ORIGIN";
    if (/destination|import|\bpod\b|discharg/u.test(l)) return "THC_DESTINATION";
    return "OTHER";
  }
  if (/documentation|\bdoc(s)? fee|b\/l fee|bill of lading fee/u.test(l)) return "DOCUMENTATION";
  if (/ocean freight|sea freight|basic freight|\bofr\b|^freight( charges?)?$/u.test(l)) return "OCEAN_FREIGHT";
  return "OTHER";
}

export function normalizeRateBasis(value: string | null | undefined): RateBasis | null {
  if (!value) return null;
  const v = collapseWhitespace(value).toLowerCase();
  if (/per (container|unit|box|cntr|teu|feu)|\/ ?(container|cntr|box)/u.test(v)) return "PER_CONTAINER";
  if (/per (shipment|bl|b\/l|bill of lading)|lump ?sum/u.test(v)) return "PER_SHIPMENT";
  return null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Strict YYYY-MM-DD with a real calendar date. */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Inclusive range check on ISO dates. */
export function isDateWithin(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}
