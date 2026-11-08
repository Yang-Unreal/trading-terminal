import { useSyncExternalStore } from "react";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface Ticker {
  symbol: string;
  last: string;
  bid?: string | null;
  ask?: string | null;
  markPrice?: string | null;
  indexPrice?: string | null;
  high24h?: string | null;
  low24h?: string | null;
  change24h?: string | null;
  fundingRate?: string | null;
  tsExchange?: number | null;
  tsReceived?: number | null;
}

export interface OrderBookLevel {
  price: string;
  quantity: string;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  tsExchange?: number | null;
  tsReceived?: number | null;
  seq?: string | null;
  source?: string | null;
}

export type TradeSide = "buy" | "sell";

export interface Trade {
  tradeId: string;
  symbol: string;
  price: string;
  size: string;
  side: TradeSide;
  tsExchange?: number | null;
  tsReceived?: number | null;
  source?: string | null;
}

export interface Candle {
  startTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  baseVolume: string;
  quoteVolume: string;
  usdtVolume?: string | null;
  tsReceived: number | null;
  source: string | null;
}

interface State {
  tickers: Record<string, Ticker>;
  orderBooks: Record<string, OrderBook>;
  trades: Record<string, Trade[]>;
  candles: Record<string, Record<string, Candle[]>>;
  status: ConnectionStatus;
  lastUpdate: number | null;
  orderBookLastUpdate: number | null;
  tradesLastUpdate: number | null;
  candleLastUpdate: number | null;
  stale: boolean;
  orderBookStale: boolean;
  tradesStale: boolean;
  candleStale: boolean;
  candleLoading: boolean;
  candleError: string | null;
}

let state: State = {
  tickers: {},
  orderBooks: {},
  trades: {},
  candles: {},
  status: "disconnected",
  lastUpdate: null,
  orderBookLastUpdate: null,
  tradesLastUpdate: null,
  candleLastUpdate: null,
  stale: false,
  orderBookStale: false,
  tradesStale: false,
  candleStale: false,
  candleLoading: false,
  candleError: null,
};

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function setState(partial: Partial<State>) { state = { ...state, ...partial }; emit(); }

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;
const subscriptions = new Set<string>();

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  setState({ status: "connecting" });
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}/ws/market`);
  ws.onopen = () => {
    reconnectAttempts = 0;
    setState({ status: "connected", stale: false, orderBookStale: false });
    subscriptions.forEach((s) => {
      ws?.send(JSON.stringify({ op: "subscribe", channel: "ticker", symbol: s }));
    });
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "ticker" || msg.type === "snapshot") {
        const d = msg.data;
        if (d?.last !== undefined) {
          const t: Ticker = {
            symbol: d.symbol,
            last: d.last,
            bid: d.bid ?? null,
            ask: d.ask ?? null,
            markPrice: d.markPrice ?? null,
            indexPrice: d.indexPrice ?? null,
            high24h: d.high24h ?? null,
            low24h: d.low24h ?? null,
            change24h: d.change24h ?? null,
            fundingRate: d.fundingRate ?? null,
            tsExchange: d.tsExchange ?? null,
            tsReceived: d.tsReceived ?? null,
          };
          state.tickers[t.symbol] = t;
          setState({ tickers: { ...state.tickers }, lastUpdate: Date.now(), stale: false });
        }
      }
      if (msg.type === "orderbook") {
        const d = msg.data;
        const book: OrderBook = {
          symbol: d.symbol,
          bids: d.bids ?? [],
          asks: d.asks ?? [],
          tsExchange: d.tsExchange ?? null,
          tsReceived: d.tsReceived ?? null,
          seq: d.seq ?? null,
          source: d.source ?? null,
        };
        state.orderBooks[book.symbol] = book;
        setState({ orderBooks: { ...state.orderBooks }, orderBookLastUpdate: Date.now(), orderBookStale: false });
      }
      if (msg.type === "trade") {
        const d = msg.data;
        const trade: Trade = {
          tradeId: d.tradeId,
          symbol: d.symbol,
          price: d.price,
          size: d.size,
          side: d.side,
          tsExchange: d.tsExchange ?? null,
          tsReceived: d.tsReceived ?? null,
          source: d.source ?? null,
        };
        const existing = state.trades[trade.symbol] ?? [];
        const updated = [trade, ...existing].slice(0, 100);
        state.trades[trade.symbol] = updated;
        setState({ trades: { ...state.trades }, tradesLastUpdate: Date.now(), tradesStale: false });
      }
      if (msg.type === "trades") {
        const d = msg.data;
        const symbol = d.symbol;
        const incoming: Trade[] = (d.trades ?? []).map((t: any) => ({
          tradeId: t.tradeId,
          symbol: t.symbol,
          price: t.price,
          size: t.size,
          side: t.side,
          tsExchange: t.tsExchange ?? null,
          tsReceived: t.tsReceived ?? null,
          source: t.source ?? null,
        }));
        const existing = state.trades[symbol] ?? [];
        const seen = new Set(existing.map((t) => t.tradeId));
        const merged = [...incoming.filter((t) => !seen.has(t.tradeId)), ...existing].slice(0, 100);
        state.trades[symbol] = merged;
        setState({ trades: { ...state.trades }, tradesLastUpdate: Date.now(), tradesStale: false });
      }
      if (msg.type === "candle") {
        const d = msg.data;
        const symbol = d.symbol;
        const granularity = d.granularity;
        const c = d.candle;
        if (!symbol || !granularity || !c) return;
        const candle: Candle = {
          startTime: c.startTime ?? 0,
          open: c.open ?? "",
          high: c.high ?? "",
          low: c.low ?? "",
          close: c.close ?? "",
          baseVolume: c.baseVolume ?? "",
          quoteVolume: c.quoteVolume ?? "",
          usdtVolume: c.usdtVolume ?? null,
          tsReceived: d.tsReceived ?? null,
          source: d.source ?? null,
        };
        const byGranularity = state.candles[symbol] ?? {};
        const existing = byGranularity[granularity] ?? [];
        const idx = existing.findIndex((x) => x.startTime === candle.startTime);
        let updated: Candle[];
        if (idx >= 0) {
          updated = existing.map((x, i) => (i === idx ? candle : x));
        } else {
          updated = [...existing, candle].sort((a, b) => a.startTime - b.startTime);
        }
        byGranularity[granularity] = updated;
        state.candles[symbol] = { ...byGranularity };
        setState({ candles: { ...state.candles }, candleLastUpdate: Date.now(), candleStale: false, candleError: null });
      }
    } catch {
      // ignore malformed
    }
  };
  ws.onclose = () => {
    ws = null;
    setState({ status: "reconnecting" });
    scheduleReconnect();
  };
  ws.onerror = () => {
    // handled by onclose
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(30000, 1000 * 2 ** reconnectAttempts) + Math.random() * 500;
  reconnectAttempts++;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

export function subscribeMarket(symbol: string) {
  subscriptions.add(symbol);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ op: "subscribe", channel: "ticker", symbol }));
  } else {
    connect();
  }
}

export function useMarketStore() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
    () => state,
  );
}

export function useTicker(symbol: string) {
  const s = useMarketStore();
  return s.tickers[symbol];
}

export function useOrderBook(symbol: string) {
  const s = useMarketStore();
  return s.orderBooks[symbol];
}

export function useTrades(symbol: string) {
  const s = useMarketStore();
  return s.trades[symbol] ?? [];
}

export function useCandles(symbol: string, granularity: string) {
  const s = useMarketStore();
  return s.candles[symbol]?.[granularity] ?? [];
}

export async function fetchCandles(
  symbol: string,
  granularity: string,
  limit = 1000,
  startTime?: number,
  endTime?: number,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    granularity,
    limit: String(limit),
  });
  if (startTime !== undefined) params.set("start_time", String(startTime));
  if (endTime !== undefined) params.set("end_time", String(endTime));
  const res = await fetch(`/api/market/candles/${symbol}?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Failed to fetch candles: ${res.status} ${errText}`);
  }
  const raw = (await res.json()) as unknown as Record<string, unknown>[];
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => ({
    startTime: (d.start_time as number) ?? 0,
    open: (d.open as string) ?? "",
    high: (d.high as string) ?? "",
    low: (d.low as string) ?? "",
    close: (d.close as string) ?? "",
    baseVolume: (d.base_volume as string) ?? "",
    quoteVolume: (d.quote_volume as string) ?? "",
    usdtVolume: (d.usdt_volume as string | null | undefined) ?? null,
    tsReceived: (d.ts_received as number | null | undefined) ?? null,
    source: (d.source as string | null | undefined) ?? null,
  }));
}

export async function fetchHistoryCandles(
  symbol: string,
  granularity: string,
  startTime?: number,
  endTime?: number,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    granularity,
  });
  if (startTime !== undefined) params.set("start_time", String(startTime));
  if (endTime !== undefined) params.set("end_time", String(endTime));
  const res = await fetch(`/api/market/history-candles/${symbol}?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Failed to fetch history candles: ${res.status} ${errText}`);
  }
  const raw = (await res.json()) as unknown as Record<string, unknown>[];
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => ({
    startTime: (d.start_time as number) ?? 0,
    open: (d.open as string) ?? "",
    high: (d.high as string) ?? "",
    low: (d.low as string) ?? "",
    close: (d.close as string) ?? "",
    baseVolume: (d.base_volume as string) ?? "",
    quoteVolume: (d.quote_volume as string) ?? "",
    usdtVolume: (d.usdt_volume as string | null | undefined) ?? null,
    tsReceived: (d.ts_received as number | null | undefined) ?? null,
    source: (d.source as string | null | undefined) ?? null,
  }));
}

export type ChartGranularity = "1m" | "5m" | "15m" | "1H" | "4H" | "1Dutc";

export interface UserPreferences {
  chart_granularity: ChartGranularity;
}

export async function fetchPreferences(): Promise<UserPreferences> {
  const res = await fetch("/api/preferences", {
    headers: { Accept: "application/json" },
    credentials: "include",
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("application/json")) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch preferences: HTTP ${res.status} (Content-Type: ${contentType}) body: ${body.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as unknown as { chart_granularity?: unknown };
  const granularity: ChartGranularity =
    typeof data.chart_granularity === "string" &&
    (["1m", "5m", "15m", "1H", "4H", "1Dutc"] as const).includes(data.chart_granularity as ChartGranularity)
      ? (data.chart_granularity as ChartGranularity)
      : "1m";
  return { chart_granularity: granularity };
}

export async function savePreferences(granularity: ChartGranularity): Promise<UserPreferences> {
  const csrfRes = await fetch("/auth/csrf", {
    credentials: "include",
  });

  const csrfContentType = csrfRes.headers.get("content-type") ?? "";
  if (!csrfRes.ok || !csrfContentType.includes("application/json")) {
    const body = await csrfRes.text().catch(() => "");
    throw new Error(
      `Failed to get CSRF token: HTTP ${csrfRes.status} (Content-Type: ${csrfContentType}) body: ${body.slice(0, 200)}`,
    );
  }

  const csrfData = (await csrfRes.json()) as { csrf_token?: string };
  const token = csrfData.csrf_token;
  if (!token) {
    throw new Error("No CSRF token");
  }

  const res = await fetch("/api/preferences", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": token,
    },
    credentials: "include",
    body: JSON.stringify({ chart_granularity: granularity }),
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("application/json")) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to save preferences: HTTP ${res.status} (Content-Type: ${contentType}) body: ${body.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as unknown as { chart_granularity?: unknown };
  const savedGranularity: ChartGranularity =
    typeof data.chart_granularity === "string" &&
    (["1m", "5m", "15m", "1H", "4H", "1Dutc"] as const).includes(data.chart_granularity as ChartGranularity)
      ? (data.chart_granularity as ChartGranularity)
      : "1m";
  return { chart_granularity: savedGranularity };
}

// stale checker
setInterval(() => {
  if (state.lastUpdate && Date.now() - state.lastUpdate > 10000) {
    if (!state.stale) setState({ stale: true });
  }
  if (state.orderBookLastUpdate && Date.now() - state.orderBookLastUpdate > 10000) {
    if (!state.orderBookStale) setState({ orderBookStale: true });
  }
  if (state.tradesLastUpdate && Date.now() - state.tradesLastUpdate > 10000) {
    if (!state.tradesStale) setState({ tradesStale: true });
  }
  if (state.candleLastUpdate && Date.now() - state.candleLastUpdate > 10000) {
    if (!state.candleStale) setState({ candleStale: true });
  }
}, 2000);