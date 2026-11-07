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

interface State {
  tickers: Record<string, Ticker>;
  orderBooks: Record<string, OrderBook>;
  status: ConnectionStatus;
  lastUpdate: number | null;
  orderBookLastUpdate: number | null;
  stale: boolean;
  orderBookStale: boolean;
}

let state: State = {
  tickers: {},
  orderBooks: {},
  status: "disconnected",
  lastUpdate: null,
  orderBookLastUpdate: null,
  stale: false,
  orderBookStale: false,
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

// stale checker
setInterval(() => {
  if (state.lastUpdate && Date.now() - state.lastUpdate > 10000) {
    if (!state.stale) setState({ stale: true });
  }
  if (state.orderBookLastUpdate && Date.now() - state.orderBookLastUpdate > 10000) {
    if (!state.orderBookStale) setState({ orderBookStale: true });
  }
}, 2000);