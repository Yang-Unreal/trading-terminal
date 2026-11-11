import type { ChartGranularity } from "@/lib/market";

/**
 * A single accepted live trade, already parsed and validated by the caller.
 *
 * Prices and sizes are numbers here because the builder performs arithmetic
 * on them; the caller is responsible for parsing the string values from the
 * normalised `Trade` model in {@link @/lib/market}.
 */
export interface LiveTrade {
  /** Exchange-assigned trade identifier, unique per symbol. */
  tradeId: string;
  symbol: string;
  /** Trade price in quote currency. Finite and positive. */
  price: number;
  /** Trade size in base currency. Finite and positive. */
  size: number;
  side: "buy" | "sell";
  /** Exchange event timestamp in milliseconds (epoch). */
  tsExchange: number;
}

/**
 * Provisional (trade-driven) state for the active (forming) candle bucket.
 */
export interface ActiveCandle {
  startTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Exchange event timestamp of the trade that established `close`. */
  closeTime: number;
  /** Volume carried over from the native candle baseline (not trade-accumulated). */
  volume: number;
  /** Number of live trades folded into this bucket. */
  tradeCount: number;
}

export interface NativeCandleSeed {
  startTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tsReceived: number;
}

export interface ActiveCandleBuilderOptions {
  /** Maximum number of trade IDs to keep for deduplication. */
  maxSeenTradeIds?: number;
}

const GRANULARITY_MS: Record<ChartGranularity, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1H": 3_600_000,
  "4H": 14_400_000,
  "1Dutc": 86_400_000,
};

/**
 * Compute the candle bucket start (epoch ms) for a trade event time.
 *
 * Intraday buckets are aligned to the Unix epoch (UTC midnight 1970), so
 * integer division yields UTC-aligned boundaries for every supported
 * granularity. `1Dutc` uses UTC midnight explicitly so the result never
 * depends on the browser's local timezone.
 */
export function bucketStartTime(ts: number, granularity: ChartGranularity): number {
  if (granularity === "1Dutc") {
    const d = new Date(ts);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const ms = GRANULARITY_MS[granularity];
  return Math.floor(ts / ms) * ms;
}

interface BucketState {
  startTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  closeTime: number;
  closeSeq: number;
  volume: number;
  tradeCount: number;
  /** Once true, Open is frozen for the lifetime of this bucket. */
  openConfirmed: boolean;
}

function toActive(state: BucketState): ActiveCandle {
  return {
    startTime: state.startTime,
    open: state.open,
    high: state.high,
    low: state.low,
    close: state.close,
    closeTime: state.closeTime,
    volume: state.volume,
    tradeCount: state.tradeCount,
  };
}

function newState(
  startTime: number,
  price: number,
  closeTime: number,
  closeSeq: number,
  volume: number,
  tradeCount: number,
  openConfirmed: boolean,
): BucketState {
  return {
    startTime,
    open: price,
    high: price,
    low: price,
    close: price,
    closeTime,
    closeSeq,
    volume,
    tradeCount,
    openConfirmed,
  };
}

/**
 * Pure active-candle builder.
 *
 * Maintains provisional active-candle state keyed by `symbol | granularity`
 * and processes accepted live trades in event-time order. The builder knows
 * nothing about React or Lightweight Charts, so it can be unit-tested in
 * isolation.
 *
 * Volume is intentionally sourced from the native candle baseline (see
 * `seedFromNative`) rather than accumulated from trades, because the current
 * data model does not provide a reliable baseline boundary for exact volume
 * reconciliation. Trade-driven Open/High/Low/Close are still applied.
 */
export class ActiveCandleBuilder {
  private readonly maxSeenTradeIds: number;
  private readonly buckets = new Map<string, BucketState>();
  private readonly seenTradeIds = new Set<string>();
  private sequence = 0;

  constructor(options?: ActiveCandleBuilderOptions) {
    this.maxSeenTradeIds = options?.maxSeenTradeIds ?? 1000;
  }

  /**
   * Process a single accepted live trade.
   *
   * Returns the updated active candle for the bucket, or `null` when the
   * trade is rejected (invalid fields, cached snapshot, or duplicate trade
   * id). Accepted trades update the bucket's OHLC in place; a newer bucket
   * replaces the previous state with exactly one new candle.
   */
  processTrade(
    symbol: string,
    granularity: ChartGranularity,
    trade: LiveTrade,
  ): ActiveCandle | null {
    if (!symbol || typeof symbol !== "string") return null;
    if (!trade.tradeId || typeof trade.tradeId !== "string") return null;
    if (!Number.isFinite(trade.price) || trade.price <= 0) return null;
    if (!Number.isFinite(trade.size) || trade.size <= 0) return null;
    if (!Number.isFinite(trade.tsExchange) || trade.tsExchange <= 0) return null;

    // Deduplicate by trade id so repeated messages never double-count.
    if (this.seenTradeIds.has(trade.tradeId)) return null;
    this.seenTradeIds.add(trade.tradeId);
    this.evictIfNeeded();

    const key = `${symbol}|${granularity}`;
    const startTime = bucketStartTime(trade.tsExchange, granularity);
    const seq = this.sequence++;

    let state = this.buckets.get(key);
    if (!state || state.startTime !== startTime) {
      // Trade-initiated open is provisional until a native baseline confirms it.
      state = newState(startTime, trade.price, trade.tsExchange, seq, 0, 1, false);
      this.buckets.set(key, state);
      return toActive(state);
    }

    state.high = Math.max(state.high, trade.price);
    state.low = Math.min(state.low, trade.price);
    state.tradeCount++;

    // Close follows the latest trade by exchange event time. An out-of-order
    // trade may move High/Low but must never move Close backwards.
    if (
      state.tradeCount === 1 ||
      trade.tsExchange > state.closeTime ||
      (trade.tsExchange === state.closeTime && seq > state.closeSeq)
    ) {
      state.close = trade.price;
      state.closeTime = trade.tsExchange;
      state.closeSeq = seq;
    }

    return toActive(state);
  }

  /**
   * Seed (or merge) the active bucket from the authoritative native candle
   * baseline. Never regresses a trade-driven Close, High or Low.
   */
  seedFromNative(symbol: string, granularity: ChartGranularity, seed: NativeCandleSeed): void {
    const key = `${symbol}|${granularity}`;
    const startTime = bucketStartTime(seed.startTime, granularity);
    const state = this.buckets.get(key);

    if (!state) {
      // Native baseline is authoritative: open is confirmed immediately.
      this.buckets.set(key, newState(startTime, seed.close, -1, -1, seed.volume, 0, true));
      const fresh = this.buckets.get(key)!;
      fresh.open = seed.open;
      fresh.high = seed.high;
      fresh.low = seed.low;
      fresh.close = seed.close;
      fresh.volume = seed.volume;
      return;
    }

    if (startTime > state.startTime) {
      // A newer native bucket becomes the baseline; previous bucket is final.
      this.buckets.set(key, newState(startTime, seed.close, -1, -1, seed.volume, 0, true));
      const fresh = this.buckets.get(key)!;
      fresh.open = seed.open;
      fresh.high = seed.high;
      fresh.low = seed.low;
      fresh.close = seed.close;
      fresh.volume = seed.volume;
      return;
    }

    if (startTime < state.startTime) {
      // Older native update: never overwrite newer provisional state.
      return;
    }

    // Same bucket: fold the native baseline in without regressing trade data.
    state.volume = seed.volume;
    state.high = Math.max(state.high, seed.high);
    state.low = Math.min(state.low, seed.low);
    // Reconcile Open exactly once: a provisional trade-initiated Open is
    // confirmed by the first native baseline, after which Open is frozen.
    if (!state.openConfirmed) {
      state.open = seed.open;
      state.openConfirmed = true;
    }
    // Close is never regressed by a same-bucket native update when trades
    // have already established it.
  }

  getActive(symbol: string, granularity: ChartGranularity): ActiveCandle | null {
    const state = this.buckets.get(`${symbol}|${granularity}`);
    return state ? toActive(state) : null;
  }

  clear(symbol?: string, granularity?: ChartGranularity): void {
    if (symbol === undefined && granularity === undefined) {
      this.buckets.clear();
      this.seenTradeIds.clear();
      this.sequence = 0;
      return;
    }
    if (symbol === undefined || granularity === undefined) return;
    this.buckets.delete(`${symbol}|${granularity}`);
  }

  private evictIfNeeded(): void {
    if (this.seenTradeIds.size <= this.maxSeenTradeIds) return;
    const toDelete = Math.max(1, Math.floor(this.maxSeenTradeIds * 0.1));
    let count = 0;
    for (const id of this.seenTradeIds) {
      this.seenTradeIds.delete(id);
      if (++count >= toDelete) break;
    }
  }
}
