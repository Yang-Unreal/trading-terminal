import { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  ColorType,
  LineStyle,
  MismatchDirection,
  type IChartApi,
  type ISeriesApi,
  type ISeriesPrimitive,
  type ISeriesPrimitiveAxisView,
  type SeriesAttachedParameter,
} from "lightweight-charts";
import type { Time, TickMarkType } from "lightweight-charts";
import { type Candle, fetchCandles, fetchHistoryCandles, useCandles, type ChartGranularity } from "@/lib/market";
import {
  formatDailyCandleDate,
  formatIntradayCandleTime,
  isDailyGranularity,
  defaultDisplayTimezone,
} from "@/lib/time-format";

const TIMEFRAMES: { label: string; value: ChartGranularity }[] = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1H", value: "1H" },
  { label: "4H", value: "4H" },
  { label: "1D", value: "1Dutc" },
];

const BULLISH_COLOR = "#22c55e";
const BEARISH_COLOR = "#ef4444";
const GRID_COLOR = "#2a2a2a";
const INITIAL_HISTORY_LIMIT = 1000;
const HISTORY_BATCH = 200;
const MAX_DAY_SPAN_MS = 90 * 24 * 60 * 60 * 1000;
const PREFETCH_THRESHOLD_BASE = 30;
const RIGHT_OFFSET_BARS = 2;

// Development-only diagnostic flag. Set to false to disable verbose logging.
const DEBUG_HISTORY = import.meta.env.DEV;

function debugHistory(...args: unknown[]): void {
  if (DEBUG_HISTORY) {
    console.log("[candlestick-history]", ...args);
  }
}

const GRANULARITY_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1H": 3_600_000,
  "4H": 14_400_000,
  "1Dutc": 86_400_000,
};

interface CandlePoint {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface VolumePoint {
  time: Time;
  value: number;
  color: string;
}

class VolumeAxisPrimitive implements ISeriesPrimitive<Time> {
  private volumeSeriesRef: React.MutableRefObject<ISeriesApi<"Histogram", Time> | null>;
  private requestUpdate: (() => void) | null = null;

  private _visible = false;
  private _volumeValue: number | null = null;
  private _coordinate = 0;
  private _text = "";
  private _textColor = "#ffffff";
  private _backColor = "#ffffff";

  constructor(volumeSeriesRef: React.MutableRefObject<ISeriesApi<"Histogram", Time> | null>) {
    this.volumeSeriesRef = volumeSeriesRef;
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.requestUpdate = null;
  }

  updateAllViews(): void {
    if (!this._visible || this._volumeValue === null) return;
    const volumeSeries = this.volumeSeriesRef.current;
    if (!volumeSeries) return;
    const coord = volumeSeries.priceToCoordinate(this._volumeValue);
    if (coord !== null) {
      this._coordinate = coord;
    } else {
      this._visible = false;
    }
  }

  setData(volumeValue: number, color: string, coordinate: number): void {
    this._visible = true;
    this._volumeValue = volumeValue;
    this._coordinate = coordinate;
    this._text = formatVolume(volumeValue);
    this._textColor = "#ffffff";
    this._backColor = color;
    this.requestUpdate?.();
  }

  clear(): void {
    this._visible = false;
    this._volumeValue = null;
    this.requestUpdate?.();
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    if (!this._visible) return [];
    return [
      {
        coordinate: () => this._coordinate,
        text: () => this._text,
        textColor: () => this._textColor,
        backColor: () => this._backColor,
        visible: () => this._visible,
        tickVisible: () => false,
      },
    ];
  }
}

function toUtcSeconds(ms: number): Time {
  return Math.floor(ms / 1000) as unknown as Time;
}

function parsePrice(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function validateCandle(c: Candle): boolean {
  const open = parsePrice(c.open);
  const high = parsePrice(c.high);
  const low = parsePrice(c.low);
  const close = parsePrice(c.close);
  if (open == null || high == null || low == null || close == null) return false;
  if (high < low) return false;
  if (open < low || open > high) return false;
  if (close < low || close > high) return false;
  return true;
}

function toCandlePoint(c: Candle): CandlePoint | null {
  if (!validateCandle(c)) return null;
  return {
    time: toUtcSeconds(c.startTime),
    open: Number(c.open.trim()),
    high: Number(c.high.trim()),
    low: Number(c.low.trim()),
    close: Number(c.close.trim()),
  };
}

function toVolumePoint(c: Candle): VolumePoint | null {
  const cp = toCandlePoint(c);
  if (!cp) return null;
  const vol = parsePrice(c.baseVolume);
  if (vol == null || vol < 0) return null;
  return {
    time: cp.time,
    value: vol,
    color: c.close >= c.open ? BULLISH_COLOR : BEARISH_COLOR,
  };
}

function formatVolume(volume: number): string {
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)}M`;
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(2)}K`;
  return volume.toFixed(2);
}

function candlesToPoints(
  candles: Candle[],
): { candlePoints: CandlePoint[]; volumePoints: VolumePoint[] } {
  const candlePoints: CandlePoint[] = [];
  const volumePoints: VolumePoint[] = [];
  for (const c of candles) {
    const cp = toCandlePoint(c);
    const vp = toVolumePoint(c);
    if (cp && vp) {
      candlePoints.push(cp);
      volumePoints.push(vp);
    }
  }
  candlePoints.sort((a, b) => a.time as unknown as number - (b.time as unknown as number));
  volumePoints.sort((a, b) => a.time as unknown as number - (b.time as unknown as number));
  return { candlePoints, volumePoints };
}

export interface CandlestickChartHandle {
  autoScale: () => void;
  fitContent: () => void;
}

interface CandlestickChartProps {
  symbol: string;
  granularity: string;
}

export const CandlestickChart = forwardRef<CandlestickChartHandle, CandlestickChartProps>(
  function CandlestickChart({ symbol, granularity }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick", Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram", Time> | null>(null);
  const volumeAxisPrimitiveRef = useRef<VolumeAxisPrimitive | null>(null);
  const requestIdRef = useRef(0);
  const olderHistoryRequestIdRef = useRef(0);
  const liveBufferRef = useRef<Map<number, Candle>>(new Map());
  const candlesMapRef = useRef<Map<number, Candle>>(new Map());
  const loadingOlderRef = useRef(false);
  const hasMoreHistoryRef = useRef(true);
  const oldestTimestampRef = useRef<number | null>(null);
  const symbolRef = useRef(symbol);
  const granularityRef = useRef(granularity);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [oldestTimestamp, setOldestTimestamp] = useState<number | null>(null);

  // Keep refs in sync with state so event handlers never read stale pagination state.
  loadingOlderRef.current = loadingOlder;
  hasMoreHistoryRef.current = hasMoreHistory;
  oldestTimestampRef.current = oldestTimestamp;
  symbolRef.current = symbol;
  granularityRef.current = granularity;

  const candles = useCandles(symbol, granularity);

  useImperativeHandle(ref, () => ({
    autoScale: () => {
      const candleSeries = candleSeriesRef.current;
      const volumeSeries = volumeSeriesRef.current;
      const chart = chartRef.current;
      if (!chart || !candleSeries || !volumeSeries) return;
      candleSeries.priceScale().applyOptions({ autoScale: true });
      volumeSeries.priceScale().applyOptions({ autoScale: true });
    },
    fitContent: () => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.timeScale().fitContent();
    },
  }));

  const applySeriesData = useCallback(
    (candlePoints: CandlePoint[], volumePoints: VolumePoint[]) => {
      const chart = chartRef.current;
      const candleSeries = candleSeriesRef.current;
      const volumeSeries = volumeSeriesRef.current;
      if (!chart || !candleSeries || !volumeSeries) return;
      candleSeries.setData(candlePoints);
      volumeSeries.setData(volumePoints);
    },
    [],
  );

  const applyLiveCandle = useCallback(
    (c: Candle) => {
      const chart = chartRef.current;
      const candleSeries = candleSeriesRef.current;
      const volumeSeries = volumeSeriesRef.current;
      if (!chart || !candleSeries || !volumeSeries) return;
      const cp = toCandlePoint(c);
      const vp = toVolumePoint(c);
      if (!cp || !vp) return;
      candleSeries.update(cp);
      volumeSeries.update(vp);
    },
    [],
  );

  const updateVolumeMarkerForVisibleRange = useCallback(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const primitive = volumeAxisPrimitiveRef.current;
    if (!chart || !candleSeries || !volumeSeries || !primitive) return;

    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range) {
      primitive.clear();
      return;
    }

    // Find the rightmost actual candle inside the visible logical range.
    // range.to may be fractional (e.g. 5.2 means bar 5 fully visible, bar 6 partially).
    const rightIndex = Math.floor(range.to);
    const candleData = candleSeries.dataByIndex(
      rightIndex,
      MismatchDirection.NearestLeft,
    );
    if (!candleData) {
      primitive.clear();
      return;
    }

    // Find matching volume data at the same logical index.
    const volumeData = volumeSeries.dataByIndex(
      rightIndex,
      MismatchDirection.NearestLeft,
    );
    if (!volumeData) {
      primitive.clear();
      return;
    }

    // Verify both series refer to the same candle timestamp.
    if ((candleData as { time: number }).time !== (volumeData as { time: number }).time) {
      primitive.clear();
      return;
    }

    const volumeValue = (volumeData as { value: number }).value;
    const volumeColor = (volumeData as { color: string }).color;

    // Clamp/hide if coordinate falls outside valid plotting area.
    const y = volumeSeries.priceToCoordinate(volumeValue);
    if (y === null) {
      primitive.clear();
      return;
    }

    primitive.setData(volumeValue, volumeColor, y);
  }, []);

  const loadHistory = useCallback(async () => {
    if (!symbol || !granularity) return;
    const requestId = ++requestIdRef.current;
    candlesMapRef.current.clear();
    liveBufferRef.current.clear();
    setLoading(true);
    setLoadingOlder(false);
    setError(null);
    setHasMoreHistory(true);
    setOldestTimestamp(null);
    loadingOlderRef.current = false;
    hasMoreHistoryRef.current = true;
    oldestTimestampRef.current = null;
    applySeriesData([], []);

    try {
      debugHistory("loadHistory: starting", { symbol, granularity, requestId });
      const history = await fetchCandles(symbol, granularity, INITIAL_HISTORY_LIMIT);
      debugHistory("loadHistory: REST response", { requestId, count: history.length });
      if (requestIdRef.current !== requestId) return;

      const valid = history.filter((c) => validateCandle(c));
      debugHistory("loadHistory: valid candles", { requestId, validCount: valid.length, totalRequested: history.length });
      for (const c of valid) {
        candlesMapRef.current.set(c.startTime, c);
      }
      const newOldest = valid.length > 0 ? Math.min(...valid.map((c) => c.startTime)) : null;
      setOldestTimestamp(newOldest);
      oldestTimestampRef.current = newOldest;

      const allCandles = Array.from(candlesMapRef.current.values()).sort(
        (a, b) => a.startTime - b.startTime,
      );
      setHasMoreHistory(true);
      hasMoreHistoryRef.current = true;

      if (requestIdRef.current !== requestId) return;
      const { candlePoints, volumePoints } = candlesToPoints(allCandles);
      applySeriesData(candlePoints, volumePoints);

      if (requestIdRef.current !== requestId) return;
      const chart = chartRef.current;
      const candleSeries = candleSeriesRef.current;
      if (!chart || !candleSeries || candlePoints.length === 0) {
        setLoading(false);
        return;
      }

      // Calculate how many bars fit in the visible chart width.
      const timeScaleWidth = chart.timeScale().width() ?? 600;
      const barSpacing = (candleSeries as any).options()?.barSpacing ?? 6;
      const visibleBars = Math.max(1, Math.ceil(timeScaleWidth / barSpacing));
      const totalBars = candlePoints.length;
      const visibleCount = Math.min(visibleBars, totalBars);
      const from = Math.max(0, totalBars - visibleCount - RIGHT_OFFSET_BARS);
      const to = Math.max(0, totalBars - RIGHT_OFFSET_BARS);
      debugHistory("loadHistory: setting initial visible range", {
        requestId,
        totalBars,
        visibleBars,
        visibleCount,
        from,
        to,
        barSpacing,
        timeScaleWidth,
      });
      chart.timeScale().setVisibleLogicalRange({ from, to });

      updateVolumeMarkerForVisibleRange();

      // If we have fewer candles than needed to fill the viewport, load older history.
      if (totalBars < visibleBars) {
        debugHistory("loadHistory: triggering loadOlderHistory (insufficient candles)", {
          requestId,
          totalBars,
          visibleBars,
        });
        loadOlderHistory();
      }

      setLoading(false);
    } catch (err) {
      debugHistory("loadHistory: error", { requestId, error: err instanceof Error ? err.message : String(err) });
      if (requestIdRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "Failed to load candles");
      setLoading(false);
    }
  }, [symbol, granularity, applySeriesData]);

  const loadOlderHistory = useCallback(async () => {
    // Use refs to avoid stale React state closures.
    const symbol = symbolRef.current;
    const granularity = granularityRef.current;
    const hasMoreHistory = hasMoreHistoryRef.current;
    const loadingOlder = loadingOlderRef.current;
    const oldestTimestamp = oldestTimestampRef.current;

    debugHistory("loadOlderHistory: entry check", {
      symbol,
      granularity,
      hasMoreHistory,
      loadingOlder,
      oldestTimestamp,
      oldestTimestampReadable: oldestTimestamp != null ? new Date(oldestTimestamp).toISOString() : null,
    });
    if (!symbol || !granularity || !hasMoreHistory || loadingOlder) return;
    const requestId = ++olderHistoryRequestIdRef.current;
    debugHistory("loadOlderHistory: starting request", { requestId, symbol, granularity });
    loadingOlderRef.current = true;
    setLoadingOlder(true);

    if (oldestTimestamp == null) {
      debugHistory("loadOlderHistory: oldestTimestamp is null, aborting");
      loadingOlderRef.current = false;
      setLoadingOlder(false);
      return;
    }

    const oldest = oldestTimestamp;
    const granularityMs = GRANULARITY_MS[granularity] ?? 60_000;
    const pageWindowMs = Math.min(HISTORY_BATCH * granularityMs, MAX_DAY_SPAN_MS);
    const endTime = oldest;
    const startTime = endTime - pageWindowMs;
    debugHistory("loadOlderHistory: pagination params", {
      requestId,
      oldest,
      oldestReadable: new Date(oldest).toISOString(),
      granularityMs,
      pageWindowMs,
      startTime,
      startTimeReadable: new Date(startTime).toISOString(),
      endTime,
      endTimeReadable: new Date(endTime).toISOString(),
    });

    try {
      const older = await fetchHistoryCandles(symbol, granularity, startTime, endTime);
      debugHistory("loadOlderHistory: REST response", {
        requestId,
        status: "ok",
        count: older.length,
        firstTs: older.length > 0 ? older[0].startTime : null,
        firstTsReadable: older.length > 0 ? new Date(older[0].startTime).toISOString() : null,
        lastTs: older.length > 0 ? older[older.length - 1].startTime : null,
        lastTsReadable: older.length > 0 ? new Date(older[older.length - 1].startTime).toISOString() : null,
      });
      if (olderHistoryRequestIdRef.current !== requestId) {
        debugHistory("loadOlderHistory: stale request, ignoring response", { requestId });
        loadingOlderRef.current = false;
        setLoadingOlder(false);
        return;
      }

      const valid = older.filter((c) => validateCandle(c));
      debugHistory("loadOlderHistory: valid candles after validation", {
        requestId,
        validCount: valid.length,
        rejectedCount: older.length - valid.length,
      });
      if (valid.length === 0) {
        debugHistory("loadOlderHistory: empty valid response — marking exhausted", { requestId });
        hasMoreHistoryRef.current = false;
        setHasMoreHistory(false);
        loadingOlderRef.current = false;
        setLoadingOlder(false);
        return;
      }

      // Filter out candles we already have (deduplicate against existing map).
      const map = candlesMapRef.current;
      const newCandles = valid.filter((c) => !map.has(c.startTime));
      debugHistory("loadOlderHistory: deduplication", {
        requestId,
        validCount: valid.length,
        newCount: newCandles.length,
        duplicateCount: valid.length - newCandles.length,
        mapSizeBefore: map.size,
      });
      if (newCandles.length === 0) {
        // No backward progress — history is exhausted.
        debugHistory("loadOlderHistory: no backward progress — marking exhausted", { requestId });
        hasMoreHistoryRef.current = false;
        setHasMoreHistory(false);
        loadingOlderRef.current = false;
        setLoadingOlder(false);
        return;
      }

      const prependedCount = newCandles.length;
      for (const c of newCandles) {
        map.set(c.startTime, c);
      }
      const newOldest = Math.min(...newCandles.map((c) => c.startTime));
      oldestTimestampRef.current = newOldest;
      setOldestTimestamp(newOldest);
      debugHistory("loadOlderHistory: merged new candles", {
        requestId,
        prependedCount,
        newOldest,
        newOldestReadable: new Date(newOldest).toISOString(),
        mapSizeAfter: map.size,
      });

      const chart = chartRef.current;
      const prevVisibleRange = chart ? chart.timeScale().getVisibleLogicalRange() : null;
      debugHistory("loadOlderHistory: prev visible range", { requestId, prevVisibleRange });

      if (olderHistoryRequestIdRef.current !== requestId) {
        debugHistory("loadOlderHistory: stale request before applySeriesData, ignoring", { requestId });
        loadingOlderRef.current = false;
        setLoadingOlder(false);
        return;
      }
      const allCandles = Array.from(map.values()).sort(
        (a, b) => a.startTime - b.startTime,
      );
      const { candlePoints, volumePoints } = candlesToPoints(allCandles);
      applySeriesData(candlePoints, volumePoints);

      // Restore the viewport: shift logical range by the number of prepended bars.
      if (chart && prevVisibleRange) {
        chart.timeScale().setVisibleLogicalRange({
          from: prevVisibleRange.from + prependedCount,
          to: prevVisibleRange.to + prependedCount,
        });
        debugHistory("loadOlderHistory: restored visible range", {
          requestId,
          prevVisibleRange,
          newRange: {
            from: prevVisibleRange.from + prependedCount,
            to: prevVisibleRange.to + prependedCount,
          },
          prependedCount,
        });
      }

      updateVolumeMarkerForVisibleRange();

      // Continue loading if we're still close to the left edge.
      const chartForBars = chartRef.current;
      const barsInfo = chartForBars && candleSeriesRef.current
        ? candleSeriesRef.current.barsInLogicalRange(chartForBars.timeScale().getVisibleLogicalRange()!)
        : null;
      const visibleBars = Math.max(
        1,
        Math.ceil((chartForBars?.timeScale().width() ?? 600) / 6),
      );
      const threshold = Math.max(PREFETCH_THRESHOLD_BASE, Math.ceil(visibleBars * 0.25));
      debugHistory("loadOlderHistory: post-merge bars check", {
        requestId,
        barsInfo: barsInfo ? { barsBefore: barsInfo.barsBefore, barsAfter: barsInfo.barsAfter } : null,
        visibleBars,
        threshold,
        shouldContinue: barsInfo ? barsInfo.barsBefore < threshold : false,
      });
      if (barsInfo && barsInfo.barsBefore < threshold) {
        debugHistory("loadOlderHistory: auto-continuing to load next page", { requestId });
        loadOlderHistory();
      }

      loadingOlderRef.current = false;
      setLoadingOlder(false);
      debugHistory("loadOlderHistory: request complete", { requestId, success: true });
    } catch (err) {
      debugHistory("loadOlderHistory: error", {
        requestId,
        error: err instanceof Error ? err.message : String(err),
        errorStatus: err instanceof Error && "status" in err ? (err as any).status : null,
      });
      if (olderHistoryRequestIdRef.current !== requestId) return;
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [applySeriesData]);

  // 1. Create chart once on mount (or when granularity changes - recreate for clean state)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#0f172a" },
        textColor: "#e2e8f0",
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { visible: true, style: LineStyle.Dotted, color: "#64748b" },
        horzLine: { visible: true, style: LineStyle.Dotted, color: "#64748b" },
      },
      width: container.clientWidth || 600,
      height: container.clientHeight || 400,
      leftPriceScale: {
        visible: false,
        borderVisible: false,
      },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
      },
      timeScale: {
        visible: true,
        timeVisible: true,
        secondsVisible: granularity === "1m",
        borderVisible: false,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType, locale: string): string | null => {
          const timestampMs = (time as unknown as number) * 1000;
          if (isDailyGranularity(granularity)) {
            return formatDailyCandleDate(timestampMs);
          }
          return formatIntradayCandleTime(timestampMs, defaultDisplayTimezone());
        },
      },
      localization: {
        locale: "en-US",
        dateFormat: "dd MMM 'yy",
        timeFormatter: (time: Time): string => {
          const timestampMs = (time as unknown as number) * 1000;
          if (isDailyGranularity(granularity)) {
            return formatDailyCandleDate(timestampMs);
          }
          return formatIntradayCandleTime(timestampMs, defaultDisplayTimezone());
        },
      },
    });

    const candleSeriesApi = chart.addSeries(CandlestickSeries, {
      priceScaleId: "right",
      upColor: BULLISH_COLOR,
      downColor: BEARISH_COLOR,
      borderVisible: false,
      wickUpColor: BULLISH_COLOR,
      wickDownColor: BEARISH_COLOR,
    });
    const volumeSeriesApi = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      priceFormat: {
        type: "volume",
      },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    volumeSeriesApi.priceScale().applyOptions({
      scaleMargins: {
        top: 0.70,
        bottom: 0.02,
      },
    });

    candleSeriesApi.priceScale().applyOptions({
      autoScale: true,
      scaleMargins: {
        top: 0.05,
        bottom: 0.30,
      },
    });

    const volumeAxisPrimitive = new VolumeAxisPrimitive(volumeSeriesRef);
    candleSeriesApi.attachPrimitive(volumeAxisPrimitive);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeriesApi;
    volumeSeriesRef.current = volumeSeriesApi;
    volumeAxisPrimitiveRef.current = volumeAxisPrimitive;

    return () => {
      candleSeriesApi.detachPrimitive(volumeAxisPrimitive);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      volumeAxisPrimitiveRef.current = null;
    };
  }, [granularity]);

  // 2. Subscribe to visible logical range changes for volume marker sync and older history pagination
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    const onVisibleLogicalRangeChange = () => {
      debugHistory("onVisibleLogicalRangeChange: fired", {
        symbol: symbolRef.current,
        granularity: granularityRef.current,
        oldestTimestamp: oldestTimestampRef.current,
        oldestTimestampReadable: oldestTimestampRef.current != null ? new Date(oldestTimestampRef.current).toISOString() : null,
        hasMoreHistory: hasMoreHistoryRef.current,
        loadingOlder: loadingOlderRef.current,
      });
      // Update volume marker to rightmost visible candle
      updateVolumeMarkerForVisibleRange();

      // Older history pagination: load more when approaching oldest loaded candle.
      const chart = chartRef.current;
      const candleSeries = candleSeriesRef.current;
      const volumeSeries = volumeSeriesRef.current;
      if (!chart || !candleSeries || !volumeSeries) return;

      const range = chart.timeScale().getVisibleLogicalRange();
      debugHistory("onVisibleLogicalRangeChange: range", { range });
      if (!range) return;

      // Use refs to avoid stale React state closures.
      const oldest = oldestTimestampRef.current;
      if (oldest == null || !hasMoreHistoryRef.current || loadingOlderRef.current) {
        debugHistory("onVisibleLogicalRangeChange: short-circuit", {
          oldestNull: oldest == null,
          hasMoreHistoryFalse: !hasMoreHistoryRef.current,
          loadingOlderTrue: loadingOlderRef.current,
        });
        return;
      }

      const barsInfo = candleSeries.barsInLogicalRange(range);
      debugHistory("onVisibleLogicalRangeChange: barsInLogicalRange", {
        range,
        barsInfo: barsInfo ? { barsBefore: barsInfo.barsBefore, barsAfter: barsInfo.barsAfter } : null,
      });

      let barsBefore: number;
      if (barsInfo) {
        barsBefore = barsInfo.barsBefore;
      } else {
        // barsInLogicalRange returned null — no series data found in the requested range.
        // Inspect range.from to determine if we're at or beyond the earliest loaded logical index.
        // If from is small, we're near the left boundary and should load older history.
        barsBefore = range.from;
        debugHistory("onVisibleLogicalRangeChange: barsInfo null, using range.from as barsBefore", {
          rangeFrom: range.from,
          barsBefore,
        });
      }

      // Do NOT reject negative barsBefore. Per the LWC v5 spec:
      // Negative barsBefore means the first loaded candle is inside the visible range,
      // with empty logical space between that candle and the visible range's left boundary.
      // This still means we are at/approaching the oldest data and should prefetch.
      const timeScaleWidth = chart.timeScale().width();
      const barSpacing = (candleSeries as any).options().barSpacing ?? 6;
      const visibleBars = Math.max(1, Math.ceil(timeScaleWidth / barSpacing));
      const threshold = Math.max(PREFETCH_THRESHOLD_BASE, Math.ceil(visibleBars * 0.25));
      debugHistory("onVisibleLogicalRangeChange: trigger check", {
        barsBefore,
        threshold,
        visibleBars,
        timeScaleWidth,
        barSpacing,
        shouldTrigger: barsBefore < threshold,
      });

      if (barsBefore < threshold) {
        debugHistory("onVisibleLogicalRangeChange: triggering loadOlderHistory", {
          barsBefore,
          threshold,
        });
        loadOlderHistory();
      }
    };

    const onCandleDataChanged = () => {
      updateVolumeMarkerForVisibleRange();
    };

    const onVolumeDataChanged = () => {
      updateVolumeMarkerForVisibleRange();
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
    candleSeries.subscribeDataChanged(onCandleDataChanged);
    volumeSeries.subscribeDataChanged(onVolumeDataChanged);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
      candleSeries.unsubscribeDataChanged(onCandleDataChanged);
      volumeSeries.unsubscribeDataChanged(onVolumeDataChanged);
    };
  }, [updateVolumeMarkerForVisibleRange, loadOlderHistory, granularity]);

  // 3. Load history after chart is created
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // 4. Apply live candle updates from the store
  useEffect(() => {
    if (!candles.length) return;
    const latest = candles[candles.length - 1];
    if (!latest) return;

    const map = candlesMapRef.current;
    const existing = map.get(latest.startTime);
    if (existing && existing.source === "websocket") return;

    map.set(latest.startTime, latest);

    let allCandles = Array.from(map.values()).sort((a, b) => a.startTime - b.startTime);

    const { candlePoints, volumePoints } = candlesToPoints(allCandles);

    if (loading) {
      liveBufferRef.current.set(latest.startTime, latest);
      return;
    }

    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    const cp = toCandlePoint(latest);
    const vp = toVolumePoint(latest);
    if (!cp || !vp) return;

    const lastPoint = candlePoints[candlePoints.length - 1];
    if (lastPoint && lastPoint.time === cp.time) {
      candleSeries.update(cp);
      volumeSeries.update(vp);
    } else {
      candleSeries.setData(candlePoints);
      volumeSeries.setData(volumePoints);
    }

    updateVolumeMarkerForVisibleRange();
  }, [candles, loading, updateVolumeMarkerForVisibleRange]);

  // 5. Resize handler
  useEffect(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    if (!container || !chart) return;

    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      chart.resize(container.clientWidth, container.clientHeight);
      updateVolumeMarkerForVisibleRange();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateVolumeMarkerForVisibleRange]);

  return (
    <div
      ref={containerRef}
      className="w-full min-h-[380px] h-[clamp(380px,55vh,520px)] lg:min-h-[480px] lg:h-[clamp(480px,62vh,720px)] rounded-lg border border-slate-700 bg-slate-900 relative overflow-hidden"
    >
    {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 text-sm text-slate-400">
          Loading candles…
        </div>
      )}
      {loadingOlder && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-800/90 text-xs text-slate-400 px-2 py-1 rounded border border-slate-700">
          Loading older candles…
        </div>
      )}
      {!loadingOlder && !hasMoreHistory && oldestTimestamp != null && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-800/90 text-xs text-slate-400 px-2 py-1 rounded border border-slate-700">
          No more historical data
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
);

export function CandlestickControls({
  granularity,
  onGranularityChange,
  onAuto,
  onFitAll,
  loadingOlder,
  saveError,
}: {
  granularity: string;
  onGranularityChange: (value: ChartGranularity) => void;
  onAuto: () => void;
  onFitAll: () => void;
  loadingOlder: boolean;
  saveError?: string | null;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-sm font-semibold">Candlestick Chart</h2>
        <TimeframeSelector granularity={granularity} onChange={onGranularityChange} />
        {saveError && (
          <span className="text-xs text-red-400 mt-1 block">Preference save failed: {saveError}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onAuto}
          className="rounded-md px-3 py-1 text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600"
        >
          Auto
        </button>
        <button
          onClick={onFitAll}
          className="rounded-md px-3 py-1 text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600"
        >
          Fit All
        </button>
        {loadingOlder && (
          <span className="text-xs text-slate-400 animate-pulse">Loading older…</span>
        )}
      </div>
    </div>
  );
}

export function TimeframeSelector({ granularity, onChange }: { granularity: string; onChange: (value: ChartGranularity) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Timeframe</span>
      <div className="rounded-lg border bg-slate-800 p-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.value}
            onClick={() => onChange(tf.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              granularity === tf.value
                ? "bg-slate-600 text-white"
                : "text-slate-300 hover:bg-slate-700"
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export { TIMEFRAMES };
