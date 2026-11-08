import { describe, it, expect } from "vitest";

const GRANULARITY_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1H": 3_600_000,
  "4H": 14_400_000,
  "1D": 86_400_000,
};

describe("GRANULARITY_MS mapping", () => {
  it("1m duration is 60 seconds", () => {
    expect(GRANULARITY_MS["1m"]).toBe(60_000);
  });

  it("5m duration is 300 seconds", () => {
    expect(GRANULARITY_MS["5m"]).toBe(300_000);
  });

  it("15m duration is 900 seconds", () => {
    expect(GRANULARITY_MS["15m"]).toBe(900_000);
  });

  it("1H duration is 3600 seconds", () => {
    expect(GRANULARITY_MS["1H"]).toBe(3_600_000);
  });

  it("4H duration is 14400 seconds", () => {
    expect(GRANULARITY_MS["4H"]).toBe(14_400_000);
  });

  it("1D duration is 86400 seconds", () => {
    expect(GRANULARITY_MS["1D"]).toBe(86_400_000);
  });

  it("granularity casing is exact (case-sensitive)", () => {
    expect(GRANULARITY_MS["1H"]).toBeDefined();
    expect(GRANULARITY_MS["1h"]).toBeUndefined();
    expect(GRANULARITY_MS["1D"]).toBeDefined();
    expect(GRANULARITY_MS["1d"]).toBeUndefined();
  });

  it("all six supported timeframes are present", () => {
    expect(Object.keys(GRANULARITY_MS)).toEqual([
      "1m", "5m", "15m", "1H", "4H", "1D",
    ]);
  });
});
