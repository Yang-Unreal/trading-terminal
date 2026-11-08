import { describe, it, expect } from "vitest";
import {
  formatDailyCandleDate,
  formatIntradayCandleTime,
  isDailyGranularity,
  defaultDisplayTimezone,
} from "@/lib/time-format";

const NOV_7_16_00_UTC_MS = 1794067200000; // Nov 7 16:00 UTC = Nov 7 (UTC calendar date)

describe("formatDailyCandleDate", () => {
  it("displays fixed UTC calendar date for 1Dutc candles", () => {
    // 1794067200000 = Nov 7 16:00 UTC → Nov 7 (UTC)
    const result = formatDailyCandleDate(NOV_7_16_00_UTC_MS);
    expect(result).toContain("Nov 7");
  });

  it("always uses UTC regardless of input timestamp's offset", () => {
    const julyMs = Date.UTC(2026, 6, 1, 16, 0, 0); // Jul 1 16:00 UTC → Jul 1 (UTC)
    const result = formatDailyCandleDate(julyMs);
    expect(result).toContain("Jul 1");
  });

  it("does not include time components", () => {
    const result = formatDailyCandleDate(NOV_7_16_00_UTC_MS);
    expect(result).not.toMatch(/\d:\d\d/);
  });

  it("does not apply Asia/Shanghai offset", () => {
    // Nov 7 16:00 UTC would be Nov 8 in Asia/Shanghai, but UTC formatting gives Nov 7
    const result = formatDailyCandleDate(NOV_7_16_00_UTC_MS);
    expect(result).not.toContain("Nov 8");
  });
});

describe("formatIntradayCandleTime", () => {
  it("follows the selected display timezone for intraday labels", () => {
    const utcMs = Date.UTC(2026, 10, 8, 14, 32, 0); // Nov 8 14:32 UTC
    const utcResult = formatIntradayCandleTime(utcMs, "UTC");
    expect(utcResult).toContain("14:32");

    const shanghaiResult = formatIntradayCandleTime(utcMs, "Asia/Shanghai");
    expect(shanghaiResult).toContain("22:32"); // 14:32 UTC = 22:32 Asia/Shanghai
  });

  it("changes output when timezone changes", () => {
    const utcMs = Date.UTC(2026, 10, 8, 14, 32, 0);
    const nyResult = formatIntradayCandleTime(utcMs, "America/New_York");
    const shanghaiResult = formatIntradayCandleTime(utcMs, "Asia/Shanghai");
    expect(nyResult).not.toBe(shanghaiResult);
  });
});

describe("isDailyGranularity", () => {
  it("returns true for 1Dutc", () => {
    expect(isDailyGranularity("1Dutc")).toBe(true);
  });

  it("returns false for standard 1D", () => {
    expect(isDailyGranularity("1D")).toBe(false);
  });

  it("returns false for intraday granularities", () => {
    expect(isDailyGranularity("1m")).toBe(false);
    expect(isDailyGranularity("5m")).toBe(false);
    expect(isDailyGranularity("15m")).toBe(false);
    expect(isDailyGranularity("1H")).toBe(false);
    expect(isDailyGranularity("4H")).toBe(false);
  });
});

describe("defaultDisplayTimezone", () => {
  it("returns a valid IANA timezone string", () => {
    const tz = defaultDisplayTimezone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
    // Valid IANA timezones contain a slash
    expect(tz).toMatch(/\//);
  });
});

describe("daily vs intraday formatting independence", () => {
  it("1Dutc uses UTC while intraday can use a different timezone", () => {
    const utcMs = Date.UTC(2026, 10, 7, 16, 0, 0); // Nov 7 16:00 UTC
    const dailyResult = formatDailyCandleDate(utcMs); // Should be Nov 7 (UTC)
    const intradayUtcResult = formatIntradayCandleTime(utcMs, "UTC"); // Should be Nov 7
    expect(dailyResult).toContain("Nov 7");
    expect(intradayUtcResult).toContain("Nov 7");
  });

  it("changing intraday timezone never changes daily output", () => {
    const utcMs = Date.UTC(2026, 10, 7, 16, 0, 0);
    const dailyResult = formatDailyCandleDate(utcMs);
    formatIntradayCandleTime(utcMs, "America/New_York");
    formatIntradayCandleTime(utcMs, "Asia/Tokyo");
    formatIntradayCandleTime(utcMs, "UTC");
    expect(formatDailyCandleDate(utcMs)).toBe(dailyResult);
  });
});
