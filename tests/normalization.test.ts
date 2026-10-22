import { describe, expect, it } from "vitest";
import {
  formatMinor,
  isDateWithin,
  isIsoDate,
  normalizeCarrier,
  normalizeChargeType,
  normalizeContainerType,
  normalizeCurrency,
  normalizePort,
  normalizeRateBasis,
  parseAmountToMinor,
} from "../src/services/normalization.js";

describe("parseAmountToMinor", () => {
  it.each([
    ["EUR 42,500.00", 4250000],
    ["€42 500,00", 4250000],
    ["42.500,00", 4250000],
    ["42500", 4250000],
    ["42500.00", 4250000],
    ["24,000.00 EUR", 2400000],
    ["1,234,567.89", 123456789],
    ["0.5", 50],
    ["18 500,5 €", 1850050],
    ["-1,000.00", -100000],
  ])("parses %s", (input, expected) => {
    expect(parseAmountToMinor(input)).toEqual({ ok: true, minor: expected });
  });

  it.each(["42,500", "42.500", "", "EUR", "12,34,567.00", "1.234.56", "12.345", "1.005", "abc 12"])("rejects %s", (input) => {
    expect(parseAmountToMinor(input).ok).toBe(false);
  });
});

describe("formatMinor", () => {
  it("formats deterministically", () => {
    expect(formatMinor(1850000, "EUR")).toBe("EUR 18,500.00");
    expect(formatMinor(5, "EUR")).toBe("EUR 0.05");
    expect(formatMinor(123456789, "EUR")).toBe("EUR 1,234,567.89");
  });
});

describe("normalisers", () => {
  it("normalises carriers", () => {
    expect(normalizeCarrier("ATLANTIC OCEAN LINES LTD.")).toBe("atlantic ocean lines");
    expect(normalizeCarrier("Atlantic  Ocean Lines")).toBe("atlantic ocean lines");
    expect(normalizeCarrier("Pacific Ocean Lines")).not.toBe(normalizeCarrier("Atlantic Ocean Lines"));
  });

  it("normalises ports without merging different ports", () => {
    expect(normalizePort("Shanghai (CNSHA)")).toBe("CNSHA");
    expect(normalizePort("SHANGHAI")).toBe("CNSHA");
    expect(normalizePort("Port of Rotterdam")).toBe("NLRTM");
    expect(normalizePort("Rotterdam (NLRTM)")).not.toBe(normalizePort("Hamburg"));
    expect(normalizePort("Gdansk")).toBe("GDANSK");
  });

  it("normalises containers via explicit equivalences", () => {
    for (const v of ["40HC", "40' HC", "40' High Cube", "40HQ", "40ft HC"]) expect(normalizeContainerType(v)).toBe("40HC");
    expect(normalizeContainerType("40' Dry")).toBe("40GP");
    expect(normalizeContainerType("20DV")).toBe("20GP");
    expect(normalizeContainerType("40HC")).not.toBe(normalizeContainerType("40GP"));
  });

  it("classifies charges", () => {
    expect(normalizeChargeType("Ocean Freight")).toBe("OCEAN_FREIGHT");
    expect(normalizeChargeType("Bunker Adjustment Factor")).toBe("BAF");
    expect(normalizeChargeType("THC Origin")).toBe("THC_ORIGIN");
    expect(normalizeChargeType("Terminal Handling Charge - Destination")).toBe("THC_DESTINATION");
    expect(normalizeChargeType("Documentation fee")).toBe("DOCUMENTATION");
    expect(normalizeChargeType("Mystery charge")).toBe("OTHER");
  });

  it("normalises currencies and rate bases", () => {
    expect(normalizeCurrency("€")).toBe("EUR");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("euro-ish")).toBeNull();
    expect(normalizeRateBasis("per container")).toBe("PER_CONTAINER");
    expect(normalizeRateBasis("lump sum")).toBe("PER_SHIPMENT");
    expect(normalizeRateBasis("per kg")).toBeNull();
  });

  it("validates dates", () => {
    expect(isIsoDate("2026-10-15")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("15/10/2026")).toBe(false);
    expect(isDateWithin("2026-10-15", "2026-01-01", "2026-12-31")).toBe(true);
    expect(isDateWithin("2027-01-01", "2026-01-01", "2026-12-31")).toBe(false);
  });
});
