import type {
  ContractRate,
  FreightInvoice,
  InvoiceLine,
  MatchCriterion,
  ReviewReason,
  ReviewReasonCode,
} from "../types/shared.js";
import { EngineError } from "../errors.js";
import {
  isDateWithin,
  isIsoDate,
  normalizeCarrier,
  normalizeContainerType,
  normalizeCurrency,
  normalizePort,
} from "./normalization.js";

/**
 * Deterministic contract-rate matching. A rate applies only when every criterion matches
 * (charge type, carrier, route, container, shipment date within validity, currency).
 * Missing or ambiguous data never falls back to a guess: it becomes NEEDS_REVIEW.
 */

export type RateMatch =
  | { outcome: "MATCHED"; rate: ContractRate; criteria: MatchCriterion[] }
  | { outcome: "NEEDS_REVIEW"; reasons: ReviewReason[] };

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export type OverchargeCalculation = {
  billedAmountMinor: number;
  expectedAmountMinor: number;
  /** max(0, billed − expected): an undercharge is never a discrepancy. */
  differenceMinor: number;
  /** Signed billed − expected. */
  signedDifferenceMinor: number;
  isOvercharged: boolean;
};

/** Integer-only arithmetic in minor units. Throws on invalid input (programmer error). */
export function calculateOvercharge(billedMinor: number, unitRateMinor: number, quantity: number): OverchargeCalculation {
  if (!Number.isSafeInteger(billedMinor) || billedMinor < 0) {
    throw new EngineError("INVALID_INPUT", `billedMinor must be a non-negative safe integer, got ${billedMinor}`);
  }
  if (!Number.isSafeInteger(unitRateMinor) || unitRateMinor < 0) {
    throw new EngineError("INVALID_INPUT", `unitRateMinor must be a non-negative safe integer, got ${unitRateMinor}`);
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new EngineError("INVALID_INPUT", `quantity must be a positive safe integer, got ${quantity}`);
  }
  const expected = unitRateMinor * quantity;
  if (!Number.isSafeInteger(expected)) {
    throw new EngineError("INVALID_INPUT", `Expected amount ${unitRateMinor} × ${quantity} is out of safe integer range`);
  }
  const signed = billedMinor - expected;
  return {
    billedAmountMinor: billedMinor,
    expectedAmountMinor: expected,
    differenceMinor: Math.max(0, signed),
    signedDifferenceMinor: signed,
    isOvercharged: signed > 0,
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Spec signature: the applicable rate, or null when none (or not unambiguously one) applies. */
export function findApplicableRate(invoice: FreightInvoice, line: InvoiceLine, rates: ContractRate[]): ContractRate | null {
  const match = matchRate(invoice, line, rates);
  return match.outcome === "MATCHED" ? match.rate : null;
}

type InvoiceKeys = {
  carrier: string;
  origin: string;
  destination: string;
  container: string;
  date: string;
  currency: string;
};

type Failure = { code: ReviewReasonCode; message: string };

export function matchRate(invoice: FreightInvoice, line: InvoiceLine, rates: ContractRate[]): RateMatch {
  const lineCurrency = line.currency ?? invoice.currency;
  const keys = {
    carrier: normalizeCarrier(invoice.carrier),
    origin: normalizePort(invoice.origin),
    destination: normalizePort(invoice.destination),
    container: normalizeContainerType(invoice.containerType),
    date: isIsoDate(invoice.shipmentDate) ? invoice.shipmentDate : null,
    currency: normalizeCurrency(lineCurrency),
  };

  const missing: string[] = [];
  if (!keys.carrier) missing.push("carrier");
  if (!keys.date) missing.push(invoice.shipmentDate ? `shipmentDate (invalid: "${invoice.shipmentDate}")` : "shipmentDate");
  if (!keys.origin) missing.push("origin");
  if (!keys.destination) missing.push("destination");
  if (!keys.container) missing.push("containerType");
  if (!keys.currency) missing.push("currency");
  if (missing.length > 0) {
    return {
      outcome: "NEEDS_REVIEW",
      reasons: [{
        code: "MISSING_DATA",
        message: `Invoice is missing data required to match a contract rate for line ${line.id}: ${missing.join(", ")}`,
      }],
    };
  }
  const k = keys as InvoiceKeys;

  // Unclassified charges ("OTHER") are never matched: two unknown labels are not proof of the same service.
  const candidates = line.chargeType === "OTHER" ? [] : rates.filter((r) => r.chargeType === line.chargeType);
  if (candidates.length === 0) {
    return {
      outcome: "NEEDS_REVIEW",
      reasons: [{
        code: "NO_APPLICABLE_RATE",
        message: `No contract rate found for charge type ${line.chargeType} ("${line.chargeLabel}") on line ${line.id}`,
      }],
    };
  }

  const evaluated = candidates.map((rate) => ({ rate, failures: evaluateRate(invoice, k, rate) }));
  const full = evaluated.filter((e) => e.failures.length === 0).map((e) => e.rate);

  if (full.length === 0) {
    const minFailures = Math.min(...evaluated.map((e) => e.failures.length));
    const reasons: ReviewReason[] = [];
    const seen = new Set<string>();
    for (const e of evaluated) {
      if (e.failures.length !== minFailures) continue;
      for (const f of e.failures) {
        const message = `${f.message} (rate ${e.rate.id})`;
        if (seen.has(message)) continue;
        seen.add(message);
        reasons.push({ code: f.code, message });
      }
    }
    return { outcome: "NEEDS_REVIEW", reasons };
  }

  const [first, ...others] = full as [ContractRate, ...ContractRate[]];
  const contradictory = others.some((r) => r.unitRateMinor !== first.unitRateMinor || r.rateBasis !== first.rateBasis);
  if (contradictory) {
    return {
      outcome: "NEEDS_REVIEW",
      reasons: [{
        code: "AMBIGUOUS_RATE",
        message: `Several contract rates with different values apply to line ${line.id}: ${full.map((r) => r.id).join(", ")}`,
      }],
    };
  }
  return { outcome: "MATCHED", rate: first, criteria: buildCriteria(invoice, line, first) };
}

function evaluateRate(invoice: FreightInvoice, k: InvoiceKeys, rate: ContractRate): Failure[] {
  const failures: Failure[] = [];

  const carrier = normalizeCarrier(rate.carrier);
  if (!carrier) {
    failures.push({ code: "CARRIER_MISMATCH", message: "Contract rate has no carrier" });
  } else if (carrier !== k.carrier) {
    failures.push({
      code: "CARRIER_MISMATCH",
      message: `Invoice carrier "${invoice.carrier}" does not match contract carrier "${rate.carrier}"`,
    });
  }

  const origin = normalizePort(rate.origin);
  const destination = normalizePort(rate.destination);
  if (!origin || !destination) {
    failures.push({ code: "ROUTE_MISMATCH", message: "Contract rate has an incomplete route" });
  } else if (origin !== k.origin || destination !== k.destination) {
    failures.push({
      code: "ROUTE_MISMATCH",
      message: `Invoice route ${k.origin} → ${k.destination} does not match contract route ${origin} → ${destination}`,
    });
  }

  const container = normalizeContainerType(rate.containerType);
  if (!container) {
    failures.push({ code: "CONTAINER_MISMATCH", message: "Contract rate has no container type" });
  } else if (container !== k.container) {
    failures.push({
      code: "CONTAINER_MISMATCH",
      message: `Invoice container ${k.container} does not match contract container ${container}`,
    });
  }

  if (!isIsoDate(rate.validFrom) || !isIsoDate(rate.validTo)) {
    failures.push({ code: "DATE_OUT_OF_VALIDITY", message: "Contract rate has no valid validity period" });
  } else if (!isDateWithin(k.date, rate.validFrom, rate.validTo)) {
    failures.push({
      code: "DATE_OUT_OF_VALIDITY",
      message: `Shipment date ${k.date} is outside contract validity ${rate.validFrom} to ${rate.validTo}`,
    });
  }

  const currency = normalizeCurrency(rate.currency);
  if (!currency) {
    failures.push({ code: "CURRENCY_MISMATCH", message: "Contract rate has no currency" });
  } else if (currency !== k.currency) {
    failures.push({
      code: "CURRENCY_MISMATCH",
      message: `Invoice currency ${k.currency} does not match contract currency ${currency}`,
    });
  }

  return failures;
}

function buildCriteria(invoice: FreightInvoice, line: InvoiceLine, rate: ContractRate): MatchCriterion[] {
  const s = (v: string | null | undefined): string => v ?? "";
  return [
    {
      criterion: "CHARGE_TYPE",
      invoiceValue: `${line.chargeLabel} (${line.chargeType})`,
      contractValue: `${rate.chargeLabel} (${rate.chargeType})`,
    },
    { criterion: "CARRIER", invoiceValue: s(invoice.carrier), contractValue: s(rate.carrier) },
    {
      criterion: "ROUTE",
      invoiceValue: `${s(invoice.origin)} → ${s(invoice.destination)}`,
      contractValue: `${s(rate.origin)} → ${s(rate.destination)}`,
    },
    { criterion: "CONTAINER", invoiceValue: s(invoice.containerType), contractValue: s(rate.containerType) },
    { criterion: "DATE", invoiceValue: s(invoice.shipmentDate), contractValue: `${s(rate.validFrom)} to ${s(rate.validTo)}` },
    { criterion: "CURRENCY", invoiceValue: s(line.currency ?? invoice.currency), contractValue: s(rate.currency) },
  ];
}
