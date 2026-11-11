/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { state, subscribeMarket, fetchCandles } from "@/lib/market";

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
        data: { symbol: "BTCUSDT", last: "100", isSnapshot: false },
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
          isSnapshot: false,
        },
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
          isSnapshot: false,
        },
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
          isSnapshot: false,
        },
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
        data: { symbol: "BTCUSDT", last: "1", isSnapshot: false },
      }),
    });
    vi.restoreAllMocks();
    vi.spyOn(performance, "now").mockReturnValue(200);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "orderbook",
        data: { symbol: "BTCUSDT", bids: [], asks: [], isSnapshot: false },
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
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1", isSnapshot: false } }),
    });
    vi.restoreAllMocks();
    vi.spyOn(performance, "now").mockReturnValue(200);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "ETHUSDT", last: "2", isSnapshot: false } }),
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
          isSnapshot: false,
        },
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
          isSnapshot: false,
        },
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
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1", isSnapshot: false } }),
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
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1", isSnapshot: false } }),
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
        data: { symbol: "BTCUSDT", last: "50", isSnapshot: true },
      }),
    });
    // Displayed data updated from cache
    expect(state.tickers["BTCUSDT"]?.last).toBe("50");
    // Monotonic timestamp NOT refreshed by cached snapshot
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBeUndefined();
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
          isSnapshot: true,
        },
      }),
    });
    expect(state.orderBooks["ETHUSDT"]?.bids).toEqual([["1", "2"]]);
    expect(state.orderBookLastWsAtMono["ETHUSDT"]).toBeUndefined();
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
          isSnapshot: false,
        },
      }),
    });
    expect(state.tradeLastWsAtMono["BTCUSDT"]).toBe(5555);
    vi.restoreAllMocks();
  });

  it("replaying cached data after reconnect does not refresh existing monotonic timestamps", () => {
    vi.spyOn(performance, "now").mockReturnValue(5000);
    subscribeMarket("BTCUSDT");
    // Live message establishes freshness
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1", isSnapshot: false } }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(5000);

    // Reconnect: close old socket, new one replays cached snapshot
    latestWS().readyState = CLOSED;
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(9999);
    latestWS().onmessage({
      data: JSON.stringify({
        type: "snapshot",
        data: { symbol: "BTCUSDT", last: "99", isSnapshot: true },
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
        data: { symbol: "NEWUSDT", last: "77", isSnapshot: true },
      }),
    });
    expect(state.tickerLastWsAtMono["NEWUSDT"]).toBeUndefined();
    vi.restoreAllMocks();

    // First subsequent valid live message establishes freshness
    vi.spyOn(performance, "now").mockReturnValue(2222);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "NEWUSDT", last: "78", isSnapshot: false } }),
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
        data: { symbol: "BTCUSDT", last: "1", isSnapshot: true },
      }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("live broadcast messages carry isSnapshot: false", () => {
    subscribeMarket("BTCUSDT");
    vi.spyOn(performance, "now").mockReturnValue(3333);
    latestWS().onmessage({
      data: JSON.stringify({ type: "ticker", data: { symbol: "BTCUSDT", last: "1", isSnapshot: false } }),
    });
    expect(state.tickerLastWsAtMono["BTCUSDT"]).toBe(3333);
    vi.restoreAllMocks();
  });
});
