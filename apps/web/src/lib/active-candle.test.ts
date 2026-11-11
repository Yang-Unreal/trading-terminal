import { describe, it, expect } from "vitest";
import {
  ActiveCandleBuilder,
  type LiveTrade,
  type NativeCandleSeed,
  bucketStartTime,
} from "@/lib/active-candle";
import type { ChartGranularity } from "@/lib/market";

const GRANULARITY_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1H": 3_600_000,
  "4H": 14_400_000,
  "1Dutc": 86_400_000,
};

function trade(overrides: Partial<LiveTrade> = {}): LiveTrade {
  return {
    tradeId: "t1",
    symbol: "BTCUSDT",
    price: 100,
    size: 1,
    side: "buy",
    tsExchange: 1790000000000,
    ...overrides,
  }
}

const BASE = 1789999980000; // aligned 1m bucket boundary
function seed(overrides: Partial<NativeCandleSeed> = {}): NativeCandleSeed {
  return {
    startTime: BASE,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    tsReceived: 1790000000000,
    ...overrides,
  }
}

describe("ActiveCandleBuilder", () => {
  it("1. First Trade initializes an active candle", () => {
    const b = new ActiveCandleBuilder();
    const c = b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 100, size: 1, tsExchange: 1790000000000 }));
    expect(c).not.toBeNull();
    expect(c!.open).toBe(100);
    expect(c!.close).toBe(100);
    expect(c!.high).toBe(100);
    expect(c!.low).toBe(100);
    expect(c!.startTime).toBe(bucketStartTime(1790000000000, "1m"));
    expect(c!.tradeCount).toBe(1);
  });

  it("2. Another Trade in the same bucket updates the existing candle", () => {
    const b = new ActiveCandleBuilder();
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 100, size: 1, tsExchange: 1790000000000 }));
    const c = b.processTrade("BTCUSDT", "1m", trade({ tradeId: "b", price: 105, size: 2, tsExchange: 1790000010000 }));
    expect(c!.close).toBe(105);
    expect(c!.high).toBe(105);
    expect(c!.tradeCount).toBe(2);
  });

  it("3. Candle count remains unchanged for same-bucket updates", () => {
    const b = new ActiveCandleBuilder();
    const ts = 1790000000000; // aligned 1m bucket boundary
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 100, size: 1, tsExchange: ts }));
    const first = b.getActive("BTCUSDT", "1m")!;
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "b", price: 105, size: 2, tsExchange: ts + 1000 }));
    const second = b.getActive("BTCUSDT", "1m")!;
    // Same bucket: same startTime, trade count increased, one candle.
    expect(second.startTime).toBe(first.startTime);
    expect(second.tradeCount).toBe(2);
    expect(b.getActive("BTCUSDT", "1m")).not.toBeNull();
  });

  it("4. Close follows the latest Trade", () => {
    const b = new ActiveCandleBuilder();
    const ts = 1790000000000;
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 100, size: 1, tsExchange: ts }));
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "b", price: 105, size: 2, tsExchange: ts + 10000 }));
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "c", price: 102, size: 1, tsExchange: ts + 20000 }));
    expect(b.getActive("BTCUSDT", "1m")!.close).toBe(102);
  });

  it("5. High and Low update correctly", () => {
    const b = new ActiveCandleBuilder();
    const ts = 1790000000000;
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 100, size: 1, tsExchange: ts }));
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "b", price: 110, size: 1, tsExchange: ts + 10000 }));
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "c", price: 90, size: 1, tsExchange: ts + 20000 }));
    const c = b.getActive("BTCUSDT", "1m")!;
    expect(c.high).toBe(110);
    expect(c.low).toBe(90);
    expect(c.close).toBe(90);
  });

  it("6. New bucket creates a new candle", () => {
    const b = new ActiveCandleBuilder();
    const ts = 1790000000000;
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 100, size: 1, tsExchange: ts }));
    const c = b.processTrade("BTCUSDT", "1m", trade({ tradeId: "b", price: 105, size: 1, tsExchange: ts + 70000 }));
    expect(c!.startTime).toBe(bucketStartTime(ts + 70000, "1m"));
    expect(c!.close).toBe(105);
  });

  it("7. Duplicate tradeId is ignored", () => {
    const b = new ActiveCandleBuilder();
    const ts = 1790000000000;
    const c1 = b.processTrade("BTCUSDT", "1m", trade({ tradeId: "dup", price: 100, size: 1, tsExchange: ts }));
    const c2 = b.processTrade("BTCUSDT", "1m", trade({ tradeId: "dup", price: 9999, size: 1, tsExchange: ts + 10000 }));
    expect(c2).toBeNull();
    expect(b.getActive("BTCUSDT", "1m")!.close).toBe(100);
    expect(b.getActive("BTCUSDT", "1m")!.tradeCount).toBe(1);
  });

  it("8. Out-of-order Trade does not regress Close", () => {
    const b = new ActiveCandleBuilder();
    const ts = 1790000000000;
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 100, size: 1, tsExchange: ts + 50000 }));
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "b", price: 110, size: 1, tsExchange: ts + 60000 }));
    // Out-of-order older trade
    const c = b.processTrade("BTCUSDT", "1m", trade({ tradeId: "c", price: 90, size: 1, tsExchange: ts + 55000 }));
    expect(c).not.toBeNull();
    expect(c!.close).toBe(110);
    expect(c!.high).toBe(110);
    expect(c!.low).toBe(90);
  });

  it("9. Invalid trade (e.g. cached snapshot replay with no event time) is ignored", () => {
    const b = new ActiveCandleBuilder();
    const ts = 1790000000000;
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "live", price: 100, size: 1, tsExchange: ts }));
    // A replayed cached snapshot has no meaningful exchange event time; reject.
    const rejected = b.processTrade("BTCUSDT", "1m", trade({ tradeId: "snap", price: 100, size: 1, tsExchange: 0 }));
    expect(rejected).toBeNull();
    expect(b.getActive("BTCUSDT", "1m")!.tradeCount).toBe(1);
  });

  it("10. Different symbols are isolated", () => {
    const b = new ActiveCandleBuilder();
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", symbol: "BTCUSDT", price: 100, size: 1, tsExchange: 1790000000000 }));
    b.processTrade("ETHUSDT", "1m", trade({ tradeId: "b", symbol: "ETHUSDT", price: 2000, size: 1, tsExchange: 1790000000000 }));
    expect(b.getActive("BTCUSDT", "1m")!.close).toBe(100);
    expect(b.getActive("ETHUSDT", "1m")!.close).toBe(2000);
  });

  it("11. Different granularities are isolated", () => {
    const b = new ActiveCandleBuilder();
    b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 100, size: 1, tsExchange: 1790000000000 }));
    b.processTrade("BTCUSDT", "5m", trade({ tradeId: "b", price: 200, size: 1, tsExchange: 1790000000000 }));
    expect(b.getActive("BTCUSDT", "1m")!.close).toBe(100);
    expect(b.getActive("BTCUSDT", "5m")!.close).toBe(200);
  });

  it("12. 1Dutc uses UTC bucket boundaries", () => {
    // A timestamp just before UTC midnight and just after should fall into
    // different buckets when using UTC midnight.
    const before = new Date(Date.UTC(2025, 0, 0, 23, 59, 59, 999)).getTime();
    const after = new Date(Date.UTC(2025, 0, 1, 0, 0, 0, 0)).getTime();
    const b = new ActiveCandleBuilder();
    b.processTrade("BTCUSDT", "1Dutc", trade({ tradeId: "a", price: 100, size: 1, tsExchange: before }));
    b.processTrade("BTCUSDT", "1Dutc", trade({ tradeId: "b", price: 200, size: 1, tsExchange: after }));
    expect(b.getActive("BTCUSDT", "1Dutc")!.startTime).toBe(after);
    expect(b.getActive("BTCUSDT", "1Dutc")!.close).toBe(200);
  });

  describe("granularity bucket boundaries", () => {
    const granularities: [ChartGranularity, number][] = [
      ["1m", 60_000], ["5m", 300_000], ["15m", 900_000],
      ["1H", 3_600_000], ["4H", 14_400_000],
    ];
    for (const [g, ms] of granularities) {
      it(`${g} buckets align to ${ms}ms`, () => {
        const ts = 1790000000000 + 12345;
        const expected = Math.floor(ts / ms) * ms;
        expect(bucketStartTime(ts, g as ChartGranularity)).toBe(expected);
      });
    }
  });

  describe("Native baseline", () => {
    it("seeds active bucket from native candle when empty", () => {
      const b = new ActiveCandleBuilder();
      b.seedFromNative("BTCUSDT", "1m", seed());
      const c = b.getActive("BTCUSDT", "1m")!;
      expect(c.open).toBe(100);
      expect(c.high).toBe(101);
      expect(c.low).toBe(99);
      expect(c.close).toBe(100);
      expect(c.volume).toBe(10);
      expect(c.tradeCount).toBe(0);
    });

    it("trade updates seed-derived bucket without regressing close", () => {
      const b = new ActiveCandleBuilder();
      b.seedFromNative("BTCUSDT", "1m", seed());
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 102, size: 1, tsExchange: BASE }));
      const c = b.getActive("BTCUSDT", "1m")!;
      expect(c.close).toBe(102);
      expect(c.tradeCount).toBe(1);
    });

    it("newer native bucket replaces the baseline", () => {
      const b = new ActiveCandleBuilder();
      b.seedFromNative("BTCUSDT", "1m", seed());
      b.seedFromNative("BTCUSDT", "1m", seed({ startTime: BASE + 60000, close: 105 }));
      expect(b.getActive("BTCUSDT", "1m")!.startTime).toBe(BASE + 60000);
      expect(b.getActive("BTCUSDT", "1m")!.close).toBe(105);
    });

    it("older native update does not overwrite newer trade-driven state", () => {
      const b = new ActiveCandleBuilder();
      b.seedFromNative("BTCUSDT", "1m", seed());
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 110, size: 1, tsExchange: BASE }));
      b.seedFromNative("BTCUSDT", "1m", seed({ close: 50 }));
      expect(b.getActive("BTCUSDT", "1m")!.close).toBe(110);
    });

    it("deduplicates trade ids with bounded memory", () => {
      const b = new ActiveCandleBuilder({ maxSeenTradeIds: 5 });
      const ts = 1790000000000;
      for (let i = 0; i < 10; i++) {
        b.processTrade("BTCUSDT", "1m", trade({ tradeId: `t${i}`, price: 100, size: 1, tsExchange: ts }));
      }
      // All in same bucket; each unique trade id counted once.
      expect(b.getActive("BTCUSDT", "1m")!.tradeCount).toBe(10);
    });
  });

  describe("Open invariance", () => {
    it("Open stays fixed when native baseline establishes it, then trades arrive", () => {
      const b = new ActiveCandleBuilder();
      b.seedFromNative("BTCUSDT", "1m", seed({ open: 100 }));
      expect(b.getActive("BTCUSDT", "1m")!.open).toBe(100);

      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 110, size: 1, tsExchange: BASE }));
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "b", price: 90, size: 1, tsExchange: BASE }));
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "c", price: 120, size: 1, tsExchange: BASE }));

      const c = b.getActive("BTCUSDT", "1m")!;
      expect(c.open).toBe(100);
      expect(c.high).toBe(120);
      expect(c.low).toBe(90);
      expect(c.close).toBe(120);
      expect(c.tradeCount).toBe(3);
    });

    it("Out-of-order Trade does not change authoritative Open", () => {
      const b = new ActiveCandleBuilder();
      b.seedFromNative("BTCUSDT", "1m", seed({ open: 100 }));
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 110, size: 1, tsExchange: BASE + 10000 }));
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "b", price: 115, size: 1, tsExchange: BASE + 20000 }));
      // Late out-of-order older trade
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "c", price: 95, size: 1, tsExchange: BASE + 5000 }));

      expect(b.getActive("BTCUSDT", "1m")!.open).toBe(100);
      expect(b.getActive("BTCUSDT", "1m")!.low).toBe(95);
    });

    it("Same-bucket native reconciliation does not change confirmed Open", () => {
      const b = new ActiveCandleBuilder();
      b.seedFromNative("BTCUSDT", "1m", seed({ open: 100 }));
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 110, size: 1, tsExchange: BASE }));

      // Delayed native candle with a different Open must not flip Open.
      b.seedFromNative("BTCUSDT", "1m", seed({ open: 9999, close: 50 }));
      expect(b.getActive("BTCUSDT", "1m")!.open).toBe(100);
      // Close must not regress either.
      expect(b.getActive("BTCUSDT", "1m")!.close).toBe(110);
    });

    it("New bucket receives its own Open; previous bucket Open unchanged", () => {
      const b = new ActiveCandleBuilder();
      b.seedFromNative("BTCUSDT", "1m", seed({ open: 100 }));
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 110, size: 1, tsExchange: BASE }));

      const nextBucket = b.processTrade("BTCUSDT", "1m", trade({ tradeId: "b", price: 200, size: 1, tsExchange: BASE + 70000 }));
      expect(nextBucket!.startTime).toBe(bucketStartTime(BASE + 70000, "1m"));
      expect(nextBucket!.open).toBe(200);
      // The new bucket's Open is independent of the previous bucket's Open.
      expect(nextBucket!.open).not.toBe(100);
    });

    it("Trade-initiated Open is provisional; native baseline reconciles once then freezes", () => {
      const b = new ActiveCandleBuilder();
      // No native baseline: first trade sets provisional Open.
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "a", price: 100, size: 1, tsExchange: BASE }));
      expect(b.getActive("BTCUSDT", "1m")!.open).toBe(100);

      // First native baseline reconciles provisional Open to baseline Open.
      b.seedFromNative("BTCUSDT", "1m", seed({ open: 200 }));
      expect(b.getActive("BTCUSDT", "1m")!.open).toBe(200);

      // A subsequent native baseline with a different Open must NOT change it.
      b.seedFromNative("BTCUSDT", "1m", seed({ open: 9999 }));
      expect(b.getActive("BTCUSDT", "1m")!.open).toBe(200);

      // Subsequent trades cannot change the confirmed Open.
      b.processTrade("BTCUSDT", "1m", trade({ tradeId: "b", price: 50, size: 1, tsExchange: BASE + 1000 }));
      expect(b.getActive("BTCUSDT", "1m")!.open).toBe(200);
    });
  });
});
