/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { state, subscribeMarket, fetchCandles, evaluateTickerFreshness, useTickerFreshness, evaluateOrderBookActivity, useOrderBookActivity, type TickerFreshnessStatus, type OrderBookActivityStatus } from "@/lib/market";

const OPEN = 1;
const CLOSED = 3;

class FakeWS {
  readyState = OPEN;
  static OPEN = OPEN;
  static CONNECTING = 0;
  static CLOSED = CLOSED;
  onopen: any = null;
  onmessage: any = null;
  onclose: any = null;
  onerror: any = null;
  send = () => {};
  close = () => {};
  constructor() {
    instances.push(this);
  }
}

const instances: FakeWS[] = [];

(globalThis as any).WebSocket = FakeWS;

function latestWS(): FakeWS {
  return instances[instances.length - 1];
}

function initialState() {
  return {
    tickers: {},
    orderBooks: {},
    trades: {},
    candles: {},
    status: "disconnected",
    lastUpdate: null,
    orderBookLastUpdate: null,
    tradesLastUpdate: null,
    candleLastUpdate: null,
    tickerLastWsAtMono: {},
    orderBookLastWsAtMono: {},
    tradeLastWsAtMono: {},
    candleLastWsAtMono: {},
    stale: false,
    orderBookStale: false,
    tradesStale: false,
    candleStale: false,
    candleLoading: false,
    candleError: null,
    tickerFreshness: {},
    orderBookActivity: {},
  };
}

beforeEach(() => {
  Object.assign(state, initialState());
});

describe("market WebSocket monotonic timestamps", () => {
  it("records a monotonic timestamp for a valid ticker message", () => {
    vi.spyOn(performance, "now").mockReturnValue(12345);
    subscribeMarket("BTCUSDT");
    latestWS().onmessage({
      data: JSON.stringify({
        type: "ticker",
        data: { symbol: "BTCUSDT", last: "100" },
        isSnapshot: false,
      }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(12345);
    vi.restoreAllMocks();
  });

  it("records a monotonic timestamp for a valid order-book message", () => {
    vi.spyOn(performance, "now").mockReturnValue(2000);
    subscribeMarket("ETHUSDT");
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: {
          symbol: "ETHUSDT",
          bids: [],
          asks: [],
          tsReceived: 1,
        },
        isSnapshot: false,
      }),
    });
    expect(state.orderBookLastWsAtMono["ETHUSDT"]).toBe(2000);
    vi.restoreAllMocks();
  });

  it("records a monotonic timestamp for a valid trade message", () => {
    vi.spyOn(performance, "now").mockReturnValue(3000);
    subscribeMarket("BTCUSDT");
    latestWS().onmessage({
      data: JSON.stringify({
        type: "trade",
        data: {
          tradeId: "1",
          symbol: "BTCUSDT",
          price: "1",
          size: "1",
          side: "buy",
          tsReceived: 1,
        },
        isSnapshot: false,
      }),
    });
    expect(state.tradeLastWsAtMono["BTCUSDT"]).toBe(3000);
    vi.restoreAllMocks();
  });

  it("records the correct symbol and granularity for a candle message", () => {
    vi.spyOn(performance, "now").mockReturnValue(4000);
    subscribeMarket("BTCUSDT");
    latestWS().onmessage({
      data: JSON.stringify({
        type: "candle",
        data: {
          symbol: "BTCUSDT",
          granularity: "1m",
          candle: {
            startTime: 1000,
            open: "1",
            high: "1",
            low: "1",
            close: "1",
            baseVolume: "1",
            quoteVolume: "1",
          },
          tsReceived: 1,
        },
        isSnapshot: false,
      }),
    });
    expect(state.candleLastWsAtMono["BTCUSDT"]["1m"]).toBe(4000);
    vi.restoreAllMocks();
  });

  it("updating one channel does not update another channel", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(100);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "ticker",
        data: { symbol: "BTCUSDT", last: "1" },
        isSnapshot: false,
      }),
    });
    vi.restoreAllMocks();
    vi.spyOn(performance, "now").mockReturnValue(200);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: { symbol: "BTCUSDT", bids: [], asks: [] },
        isSnapshot: false,
      }),
    });
    vi.restoreAllMocks();
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(100);
    expect(state.orderBookLastWsAtMono["BTCUSDT"]).toBe(200);
    expect(state.tradeLastWsAtMono["BTCUSDT"]).toBeUndefined();
  });

  it("updating one symbol does not update another symbol", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(100);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1" }, isSnapshot: false }),
    });
    vi.restoreAllMocks();
    vi.spyOn(performance, "now").mockReturnValue(200);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "ETHUSDT", last: "2" }, isSnapshot: false }),
    });
    vi.restoreAllMocks();
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(100);
    expect(state.tickerLastWsAtMono["ETHUSDT"]).toBe(200);
  });

  it("updating one candle granularity does not update another granularity", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(100);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "candle",
        data: {
          symbol: "BTCUSDT",
          granularity: "1m",
          candle: {
            startTime: 1,
            open: "1",
            high: "1",
            low: "1",
            close: "1",
            baseVolume: "1",
            quoteVolume: "1",
          },
          tsReceived: 1,
        },
        isSnapshot: false,
      }),
    });
    vi.restoreAllMocks();
    vi.spyOn(performance, "now").mockReturnValue(200);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "candle",
        data: {
          symbol: "BTCUSDT",
          granularity: "5m",
          candle: {
            startTime: 2,
            open: "1",
            high: "1",
            low: "1",
            close: "1",
            baseVolume: "1",
            quoteVolume: "1",
          },
          tsReceived: 1,
        },
        isSnapshot: false,
      }),
    });
    vi.restoreAllMocks();
    expect(state.candleLastWsAtMono["BTCUSDT"]["1m"]).toBe(100);
    expect(state.candleLastWsAtMono["BTCUSDT"]["5m"]).toBe(200);
  });

  it("malformed messages do not update timestamps", () => {
    subscribeMarket("BTCUSDT");
    latestWS().onmessage({ data: "not json" });
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: {} }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBeUndefined();
    expect(state.orderBookLastWsAtMono["BTCUSDT"]).toBeUndefined();
  });

  it("REST historical candle loading does not update WebSocket timestamps", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: "00000", msg: "", data: [["1", "1", "1", "1", "1", "1", "1"]] }),
    } as any);
    subscribeMarket("BTCUSDT");
    await fetchCandles("BTCUSDT", "1m");
    expect(state.candleLastWsAtMono["BTCUSDT"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("reconnection does not refresh existing timestamps", () => {
    vi.spyOn(performance, "now").mockReturnValue(5000);
    subscribeMarket("BTCUSDT");
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1" }, isSnapshot: false }),
    });
    vi.restoreAllMocks();
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(5000);

    // Simulate a reconnect: close the old socket, open a new one.
    latestWS().readyState = CLOSED;
    subscribeMarket("BTCUSDT");
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(5000);
    vi.restoreAllMocks();
  });

  it("heartbeat messages do not refresh market-data timestamps", () => {
    subscribeMarket("BTCUSDT");
    latestWS().onmessage({ data: "ping" }); // invalid JSON, ignored
    latestWS().onmessage({ data: JSON.stringify({ type: "ping" }) }); // unknown type, ignored
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBeUndefined();
    expect(state.orderBookLastWsAtMono["BTCUSDT"]).toBeUndefined();
    expect(state.tradeLastWsAtMono["BTCUSDT"]).toBeUndefined();
    expect(state.candleLastWsAtMono["BTCUSDT"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("wall-clock changes do not affect monotonic timestamps", () => {
    vi.spyOn(Date, "now").mockReturnValue(9999999999999);
    vi.spyOn(performance, "now").mockReturnValue(777);
    subscribeMarket("BTCUSDT");
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1" }, isSnapshot: false }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(777); // performance.now, not Date.now
    expect(state.tickerLastWsAtMono["BTCUSDT"]).not.toBe(9999999999999);
    vi.restoreAllMocks();
  });

  // ---- Cached snapshot provenance ----

  it("cached ticker snapshot updates displayed data but not monotonic timestamp", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(9999);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "snapshot",
        data: { symbol: "BTCUSDT", last: "50" },
        isSnapshot: true,
      }),
    });
    // Displayed data updated from cache
    expect(state.tickers["BTCUSDT"]?.last).toBe("50");
    // Monotonic timestamp NOT refreshed by cached snapshot
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBeUndefined();
    expect(state.tickerFreshness["BTCUSDT"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("cached order-book snapshot updates displayed data but not monotonic timestamp", () => {
    subscribeMarket("ETHUSDT");
    vi.spyOn(performance, "now").mockReturnValue(9999);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: {
          symbol: "ETHUSDT",
          bids: [["1", "2"]],
          asks: [["3", "4"]],
          tsReceived: 1,
        },
        isSnapshot: true,
      }),
    });
    expect(state.orderBooks["ETHUSDT"]?.bids).toEqual([["1", "2"]]);
    expect(state.orderBookLastWsAtMono["ETHUSDT"]).toBeUndefined();
    expect(state.orderBookActivity["ETHUSDT"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("non-empty cached trades snapshot updates displayed trade history but not timestamp", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(9999);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "trades",
        data: {
          symbol: "BTCUSDT",
          trades: [
            {
              tradeId: "1",
              symbol: "BTCUSDT",
              price: "1",
              size: "1",
              side: "buy",
              tsReceived: 1,
              source: "websocket",
            },
          ],
          isSnapshot: true,
        },
      }),
    });
    expect(state.trades["BTCUSDT"]).toHaveLength(1);
    expect(state.tradeLastWsAtMono["BTCUSDT"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("empty cached trades snapshot does not refresh the timestamp", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(9999);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "trades",
        data: { symbol: "BTCUSDT", trades: [], isSnapshot: true },
      }),
    });
    expect(state.tradeLastWsAtMono["BTCUSDT"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("live trade message updates the corresponding timestamp", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(5555);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "trade",
        data: {
          tradeId: "1",
          symbol: "BTCUSDT",
          price: "1",
          size: "1",
          side: "buy",
          tsReceived: 1,
        },
        isSnapshot: false,
      }),
    });
    vi.restoreAllMocks();
    expect(state.tradeLastWsAtMono["BTCUSDT"]).toBe(5555);
    vi.restoreAllMocks();
  });

  it("replaying cached data after reconnect does not refresh existing monotonic timestamps", () => {
    vi.spyOn(performance, "now").mockReturnValue(5000);
    subscribeMarket("BTCUSDT");
    // Live message establishes freshness
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1" }, isSnapshot: false }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(5000);

    // Reconnect: close old socket, new one replays cached snapshot
    latestWS().readyState = CLOSED;
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(9999);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "snapshot",
        data: { symbol: "BTCUSDT", last: "99" },
        isSnapshot: true,
      }),
    });
    // Cached snapshot does not refresh timestamp
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(5000);
    vi.restoreAllMocks();
  });

  it("replaying cached data for a newly subscribed symbol does not establish live freshness", () => {
    subscribeMarket("NEWUSDT");
    vi.spyOn(performance, "now").mockReturnValue(1111);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "snapshot",
        data: { symbol: "NEWUSDT", last: "77" },
        isSnapshot: true,
      }),
    });
    expect(state.tickerLastWsAtMono["NEWUSDT"]).toBeUndefined();
    vi.restoreAllMocks();

    // First subsequent valid live message establishes freshness
    vi.spyOn(performance, "now").mockReturnValue(2222);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "NEWUSDT", last: "78" }, isSnapshot: false }),
    });
    expect(state.tickerLastWsAtMono["NEWUSDT"]).toBe(2222);
    vi.restoreAllMocks();
  });

  // ---- Protocol verification ----

  it("initial cached replay messages carry isSnapshot: true", () => {
    // A snapshot-typed message carries isSnapshot: true and the frontend
    // must treat it as non-live (must not refresh monotonic freshness).
    subscribeMarket("BTCUSDT");
    latestWS().onmessage({
      data: JSON.stringify({
        type: "snapshot",
        data: { symbol: "BTCUSDT", last: "1" },
        isSnapshot: true,
      }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("live broadcast messages carry isSnapshot: false", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(3333);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1" }, isSnapshot: false }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(3333);
    vi.restoreAllMocks();
  });

  // ---- Ticker freshness ----

  it("evaluateTickerFreshness: no timestamp -> no_data", () => {
    expect(evaluateTickerFreshness(null, 1000)).toBe("no_data");
  });

  it("evaluateTickerFreshness: age 0 -> fresh", () => {
    expect(evaluateTickerFreshness(1000, 1000)).toBe("fresh");
  });

  it("evaluateTickerFreshness: age just below 7s -> fresh", () => {
    expect(evaluateTickerFreshness(1000, 7999)).toBe("fresh");
  });

  it("evaluateTickerFreshness: age exactly 7s -> delayed", () => {
    expect(evaluateTickerFreshness(1000, 8000)).toBe("delayed");
  });

  it("evaluateTickerFreshness: age just below 10s -> delayed", () => {
    expect(evaluateTickerFreshness(1000, 10999)).toBe("delayed");
  });

  it("evaluateTickerFreshness: age exactly 10s -> stale", () => {
    expect(evaluateTickerFreshness(1000, 11000)).toBe("stale");
  });

  it("evaluateTickerFreshness: age above 10s -> stale", () => {
    expect(evaluateTickerFreshness(1000, 11001)).toBe("stale");
  });

  it("evaluateTickerFreshness: negative age -> fresh (edge case)", () => {
    expect(evaluateTickerFreshness(1000, 999)).toBe("fresh");
  });

  it("evaluateTickerFreshness: new live timestamp returns fresh", () => {
    expect(evaluateTickerFreshness(1000, 1000)).toBe("fresh");
    expect(evaluateTickerFreshness(5000, 5001)).toBe("fresh");
  });

  // ---- Ticker freshness store integration ----

  it("cached ticker snapshot does not establish live freshness (no_data)", () => {
    subscribeMarket("BTCUSDT");
    latestWS().onmessage({
      data: JSON.stringify({
        type: "snapshot",
        data: { symbol: "BTCUSDT", last: "50" },
        isSnapshot: true,
      }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBeUndefined();
    const status = evaluateTickerFreshness(state.tickerLastWsAtMono["BTCUSDT"], performance.now());
    expect(status).toBe("no_data");
  });

  it("valid live ticker establishes fresh status immediately", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(5000);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "100" }, isSnapshot: false }),
    });
    vi.restoreAllMocks();
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(5000);
    expect(state.tickerFreshness["BTCUSDT"]).toBe("fresh");
    const status = evaluateTickerFreshness(state.tickerLastWsAtMono["BTCUSDT"], 5000);
    expect(status).toBe("fresh");
  });

  it("live ticker freshness is per-symbol", () => {
    subscribeMarket("BTCUSDT");
    subscribeMarket("ETHUSDT");
    vi.spyOn(performance, "now").mockReturnValue(1000);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1" }, isSnapshot: false }),
    });
    vi.restoreAllMocks();
    // BTCUSDT is fresh at t=1000, ETHUSDT has no live trade
    expect(evaluateTickerFreshness(state.tickerLastWsAtMono["BTCUSDT"], 1000)).toBe("fresh");
    expect(state.tickerLastWsAtMono["ETHUSDT"]).toBeUndefined();
    expect(evaluateTickerFreshness(state.tickerLastWsAtMono["ETHUSDT"], 1000)).toBe("no_data");
  });

  it("reconnect does not refresh ticker freshness timestamp", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(5000);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1" }, isSnapshot: false }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(5000);

    // Reconnect: close old socket
    latestWS().readyState = CLOSED;
    subscribeMarket("BTCUSDT");

    // No new live message -> timestamp unchanged
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(5000);
    vi.restoreAllMocks();
  });

  it("WebSocket disconnect does not directly change ticker freshness timestamp", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(5000);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1" }, isSnapshot: false }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(5000);

    // Disconnect
    latestWS().readyState = CLOSED;
    latestWS().onclose?.();

    // Timestamp unchanged
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(5000);
    vi.restoreAllMocks();
  });

  it("age advances past fresh->delayed->stale thresholds", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(10000);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1" }, isSnapshot: false }),
    });
    vi.restoreAllMocks();

    // Fresh at t=10000 (age=0)
    expect(evaluateTickerFreshness(state.tickerLastWsAtMono["BTCUSDT"], 10000)).toBe("fresh");
    // Delayed at t=17000 (age=7000)
    expect(evaluateTickerFreshness(state.tickerLastWsAtMono["BTCUSDT"], 17000)).toBe("delayed");
    // Stale at t=20000 (age=10000)
    expect(evaluateTickerFreshness(state.tickerLastWsAtMono["BTCUSDT"], 20000)).toBe("stale");
  });

  // ---- Order Book activity ----

  it("evaluateOrderBookActivity: no timestamp -> no_data", () => {
    expect(evaluateOrderBookActivity(null, 1000)).toBe("no_data");
  });

  it("evaluateOrderBookActivity: age 0 -> recent_update", () => {
    expect(evaluateOrderBookActivity(1000, 1000)).toBe("recent_update");
  });

  it("evaluateOrderBookActivity: age just below 10s -> recent_update", () => {
    expect(evaluateOrderBookActivity(1000, 10999)).toBe("recent_update");
  });

  it("evaluateOrderBookActivity: age exactly 10s -> quiet", () => {
    expect(evaluateOrderBookActivity(1000, 11000)).toBe("quiet");
  });

  it("evaluateOrderBookActivity: age above 10s -> quiet", () => {
    expect(evaluateOrderBookActivity(1000, 11001)).toBe("quiet");
  });

  it("evaluateOrderBookActivity: negative age -> recent_update (edge case)", () => {
    expect(evaluateOrderBookActivity(1000, 999)).toBe("recent_update");
  });

  it("evaluateOrderBookActivity: new live timestamp returns recent_update", () => {
    expect(evaluateOrderBookActivity(1000, 1000)).toBe("recent_update");
    expect(evaluateOrderBookActivity(5000, 5001)).toBe("recent_update");
  });

  it("cached order-book snapshot updates displayed data but remains no_data", () => {
    subscribeMarket("BTCUSDT");
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: {
          symbol: "BTCUSDT",
          bids: [["100", "2"]],
          asks: [["101", "3"]],
        },
        isSnapshot: true,
      }),
    });
    expect(state.orderBooks["BTCUSDT"]?.bids).toEqual([["100", "2"]]);
    expect(state.orderBookLastWsAtMono["BTCUSDT"]).toBeUndefined();
    expect(state.orderBookActivity["BTCUSDT"]).toBeUndefined();
    expect(evaluateOrderBookActivity(state.orderBookLastWsAtMono["BTCUSDT"], performance.now())).toBe("no_data");
  });

  it("valid live order-book snapshot immediately sets recent_update", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(5000);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: {
          symbol: "BTCUSDT",
          bids: [["100", "2"]],
          asks: [["101", "3"]],
        },
        isSnapshot: false,
      }),
    });
    vi.restoreAllMocks();
    expect(state.orderBookLastWsAtMono["BTCUSDT"]).toBe(5000);
    expect(state.orderBookActivity["BTCUSDT"]).toBe("recent_update");
    expect(evaluateOrderBookActivity(state.orderBookLastWsAtMono["BTCUSDT"], 5000)).toBe("recent_update");
  });

  it("live order-book snapshot with empty sides still updates activity", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(5000);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: {
          symbol: "BTCUSDT",
          bids: [],
          asks: [],
        },
        isSnapshot: false,
      }),
    });
    vi.restoreAllMocks();
    // Structurally valid but empty: still a live update, so activity is refreshed
    expect(state.orderBookLastWsAtMono["BTCUSDT"]).toBe(5000);
    expect(state.orderBookActivity["BTCUSDT"]).toBe("recent_update");
  });

  it("order book activity is per-symbol", () => {
    subscribeMarket("BTCUSDT");
    subscribeMarket("ETHUSDT");
    vi.spyOn(performance, "now").mockReturnValue(1000);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: { symbol: "BTCUSDT", bids: [["100", "2"]], asks: [["101", "3"]] },
        isSnapshot: false,
      }),
    });
    vi.restoreAllMocks();
    expect(state.orderBookActivity["BTCUSDT"]).toBe("recent_update");
    expect(evaluateOrderBookActivity(state.orderBookLastWsAtMono["ETHUSDT"], performance.now())).toBe("no_data");
  });

  it("reconnect does not refresh order book activity timestamp", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(5000);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: { symbol: "BTCUSDT", bids: [["100", "2"]], asks: [["101", "3"]] },
        isSnapshot: false,
      }),
    });
    expect(state.orderBookLastWsAtMono["BTCUSDT"]).toBe(5000);

    // Reconnect: close old socket
    latestWS().readyState = CLOSED;
    subscribeMarket("BTCUSDT");

    // No new live message -> timestamp unchanged
    expect(state.orderBookLastWsAtMono["BTCUSDT"]).toBe(5000);
    vi.restoreAllMocks();
  });

  it("WebSocket disconnect does not directly change order book activity", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(5000);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: { symbol: "BTCUSDT", bids: [["100", "2"]], asks: [["101", "3"]] },
        isSnapshot: false,
      }),
    });
    expect(state.orderBookLastWsAtMono["BTCUSDT"]).toBe(5000);

    // Disconnect
    latestWS().readyState = CLOSED;
    latestWS().onclose?.();

    // Timestamp unchanged
    expect(state.orderBookLastWsAtMono["BTCUSDT"]).toBe(5000);
    vi.restoreAllMocks();
  });

  it("age advances past recent_update->quiet threshold", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(10000);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: { symbol: "BTCUSDT", bids: [["100", "2"]], asks: [["101", "3"]] },
        isSnapshot: false,
      }),
    });
    vi.restoreAllMocks();

    // recent_update at t=10000 (age=0)
    expect(evaluateOrderBookActivity(state.orderBookLastWsAtMono["BTCUSDT"], 10000)).toBe("recent_update");
    // quiet at t=20000 (age=10000)
    expect(evaluateOrderBookActivity(state.orderBookLastWsAtMono["BTCUSDT"], 20000)).toBe("quiet");
  });
});