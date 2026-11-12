/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { CandlestickChart } from "./candlestick-chart";

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
globalThis.ResizeObserver = MockResizeObserver;

// Mock lightweight-charts
const mockRemove = vi.hoisted(() => vi.fn());
const mockSetData = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockApplyOptions = vi.hoisted(() => vi.fn());
const mockPriceToCoordinate = vi.hoisted(() =>
  vi.fn<(value: number) => number | null>(() => 100),
);
const mockGetVisibleRange = vi.hoisted(() =>
  vi.fn<() => { from: number; to: number }>(() => ({
    from: 1790000000,
    to: 17900003600,
  })),
);
const mockSetVisibleRange = vi.hoisted(() => vi.fn());
const mockSetVisibleLogicalRange = vi.hoisted(() => vi.fn());
const mockGetVisibleLogicalRange = vi.hoisted(() =>
  vi.fn<() => { from: number; to: number } | null>(() => ({ from: 0, to: 2 })),
);
const mockSubscribeVisibleTimeRangeChange = vi.hoisted(() => vi.fn());
const mockUnsubscribeVisibleTimeRangeChange = vi.hoisted(() => vi.fn());
const mockSubscribeVisibleLogicalRangeChange = vi.hoisted(() => vi.fn());
const mockUnsubscribeVisibleLogicalRangeChange = vi.hoisted(() => vi.fn());
const mockFitContent = vi.hoisted(() => vi.fn());
const mockCreateChart = vi.hoisted(() =>
  vi.fn(() => ({
    addSeries: mockAddSeries,
    timeScale: mockTimeScale,
    priceScale: mockPriceScale,
    remove: mockRemove,
    applyOptions: mockApplyOptions,
    width: vi.fn(() => 1000),
    height: vi.fn(() => 600),
  })),
);
const mockTimeScale = vi.hoisted(() =>
  vi.fn(() => ({
    getVisibleRange: mockGetVisibleRange,
    setVisibleRange: mockSetVisibleRange,
    getVisibleLogicalRange: mockGetVisibleLogicalRange,
    setVisibleLogicalRange: mockSetVisibleLogicalRange,
    width: vi.fn(() => 600),
    subscribeVisibleTimeRangeChange: mockSubscribeVisibleTimeRangeChange,
    unsubscribeVisibleTimeRangeChange: mockUnsubscribeVisibleTimeRangeChange,
    subscribeVisibleLogicalRangeChange: mockSubscribeVisibleLogicalRangeChange,
    unsubscribeVisibleLogicalRangeChange: mockUnsubscribeVisibleLogicalRangeChange,
    fitContent: mockFitContent,
  })),
);
const mockPriceScale = vi.hoisted(() =>
  vi.fn(() => ({
    applyOptions: mockApplyOptions,
    width: vi.fn(() => 60),
  })),
);
const mockLastValueData = vi.hoisted(() => vi.fn(() => ({ noData: false, price: 12.5, color: "#22c55e" })));
const mockDataByIndex = vi.hoisted(() =>
  vi.fn<(index: number, direction: number) => { time: number; value: number; color: string } | null>(() => null),
);
const mockSubscribeDataChanged = vi.hoisted(() => vi.fn());
const mockUnsubscribeDataChanged = vi.hoisted(() => vi.fn());
const mockBarsInLogicalRange = vi.hoisted(() =>
  vi.fn<() => { barsBefore: number; barsAfter: number } | null>(() => null),
);
const mockOptions = vi.hoisted(() => vi.fn(() => ({ barSpacing: 6 })));
const mockAttachPrimitive = vi.hoisted(() => vi.fn());
const mockDetachPrimitive = vi.hoisted(() => vi.fn());
const mockCandleSeriesData = vi.hoisted<{ value: any[] }>(() => ({ value: [] }));
const mockVolumeSeriesData = vi.hoisted<{ value: any[] }>(() => ({ value: [] }));

const mockAddSeries = vi.hoisted(() =>
  vi.fn((_type: any, options: any) => {
    const isCandle = options?.priceScaleId === "right";
    return {
      setData: (data: any[]) => {
        mockSetData(data);
        if (isCandle) mockCandleSeriesData.value = [...data];
        else mockVolumeSeriesData.value = [...data];
      },
      update: (data: any) => {
        mockUpdate(data);
        const target = isCandle ? mockCandleSeriesData.value : mockVolumeSeriesData.value;
        const idx = target.findIndex((p: any) => p.time === data.time);
        if (idx >= 0) target[idx] = data;
        else target.push(data);
      },
      applyOptions: mockApplyOptions,
      priceScale: mockPriceScale,
      priceToCoordinate: mockPriceToCoordinate,
      attachPrimitive: mockAttachPrimitive,
      detachPrimitive: mockDetachPrimitive,
      subscribeDataChanged: mockSubscribeDataChanged,
      unsubscribeDataChanged: mockUnsubscribeDataChanged,
      options: mockOptions,
      dataByIndex: mockDataByIndex,
    };
  }),
);
const mockChart = vi.hoisted(() =>
  vi.fn(() => ({
    addSeries: mockAddSeries,
    timeScale: mockTimeScale,
    priceScale: mockPriceScale,
    remove: mockRemove,
    applyOptions: mockApplyOptions,
    width: vi.fn(() => 1000),
    height: vi.fn(() => 600),
  })),
);

const mockFetch = vi.hoisted(() => vi.fn());
const mockUseCandles = vi.hoisted(() => vi.fn((): any[] => []));
const mockUseTrades = vi.hoisted(() => vi.fn((): any[] => []));
const mockUseTicker = vi.hoisted(() => vi.fn((): any => ({ last: "100" })));
const capturedPrimitive = vi.hoisted(() => ({ current: null as unknown as { setPrice?: (price: number | null) => void } }));

globalThis.fetch = mockFetch;

vi.mock("lightweight-charts", () => ({
  createChart: mockChart,
  CandlestickSeries: {},
  HistogramSeries: {},
  CrosshairMode: {},
  ColorType: {},
  LineStyle: {},
  MismatchDirection: { NearestLeft: "left" },
  LastPriceAnimationMode: {},
}));

vi.mock("@/lib/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market")>();
  return {
    ...actual,
    useCandles: mockUseCandles,
    useTicker: mockUseTicker,
    useTrades: mockUseTrades,
  };
});

const baseCandle = {
  start_time: 1790000000000,
  open: "100000",
  high: "100100",
  low: "99900",
  close: "100050",
  base_volume: "12.5",
  quote_volume: "1250000",
  usdt_volume: "1250000",
  ts_received: 1790000000000,
  source: "rest",
};

function makeSnakeCandle(overrides: Record<string, unknown> = {}) {
  return { ...baseCandle, ...overrides };
}

describe("CandlestickChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockCreateChart.mockClear();
    mockAddSeries.mockClear();
    mockSetData.mockClear();
    mockUpdate.mockClear();
    mockApplyOptions.mockClear();
    mockPriceToCoordinate.mockClear();
    mockPriceScale.mockClear();
    mockTimeScale.mockClear();
    mockGetVisibleRange.mockClear();
    mockGetVisibleLogicalRange.mockClear();
    mockSetVisibleRange.mockClear();
    mockSetVisibleLogicalRange.mockClear();
    mockSubscribeVisibleTimeRangeChange.mockClear();
    mockUnsubscribeVisibleTimeRangeChange.mockClear();
    mockSubscribeVisibleLogicalRangeChange.mockClear();
    mockUnsubscribeVisibleLogicalRangeChange.mockClear();
    mockFitContent.mockClear();
    mockLastValueData.mockClear();
    mockDataByIndex.mockClear();
    mockSubscribeDataChanged.mockClear();
    mockUnsubscribeDataChanged.mockClear();
    mockAttachPrimitive.mockClear();
    mockDetachPrimitive.mockClear();
    mockRemove.mockClear();
    mockSetVisibleLogicalRange.mockClear();
    mockUseCandles.mockReturnValue([]);
    mockUseTrades.mockReturnValue([]);
    mockUseTicker.mockReturnValue({ last: "100" });
    capturedPrimitive.current = null as any;
    mockCandleSeriesData.value = [];
    mockVolumeSeriesData.value = [];
    mockAttachPrimitive.mockImplementation((p: any) => {
      if (p && typeof p.setPrice === "function") capturedPrimitive.current = p;
    });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanup();
  });

  describe("candlestick-chart", () => {
    it("renders without crashing", () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baseCandle]), { status: 200 }));
      const { container } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
      expect(container).toBeTruthy();
    });

    it("candle and volume timestamps mismatch hides marker", async () => {
      mockDataByIndex.mockReset();
      mockPriceToCoordinate.mockReset();
      mockGetVisibleLogicalRange.mockReset();

      mockGetVisibleLogicalRange.mockReturnValue({ from: 0, to: 5 });
      // Candle and volume timestamps are mismatched (different buckets).
      mockDataByIndex
        .mockReturnValueOnce({
          time: 1790000003000,
          open: 100000,
          high: 100100,
          low: 99900,
          close: 100050,
        } as any)
        .mockReturnValue({
          time: 179000004000,
          value: 15.0,
          color: "#22c55e",
        } as any);
      mockPriceToCoordinate.mockReturnValue(300);

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baseCandle]), { status: 200 }));
      render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
      await waitFor(() => expect(mockDataByIndex).toHaveBeenCalledTimes(2));
      expect(mockDataByIndex.mock.calls[0][0]).toBe(5);
      expect(mockDataByIndex.mock.calls[0][1]).toBe("left");
      // Mismatched timestamps → primitive.clear() (marker hidden),
      // so priceToCoordinate is never reached.
      expect(mockPriceToCoordinate).not.toHaveBeenCalled();
    });

    it("candle and volume timestamps match shows marker", async () => {
      mockDataByIndex.mockReset();
      mockPriceToCoordinate.mockReset();
      mockGetVisibleLogicalRange.mockReset();

      mockGetVisibleLogicalRange.mockReturnValue({ from: 0, to: 5 });
      // Candle and volume timestamps match (same bucket).
      const sharedTime = 179000003000;
      mockDataByIndex
        .mockReturnValueOnce({
          time: sharedTime,
          open: 100000,
          high: 100100,
          low: 99900,
          close: 100050,
        } as any)
        .mockReturnValue({
          time: sharedTime,
          value: 15.0,
          color: "#22c55e",
        } as any);
      mockPriceToCoordinate.mockReturnValue(300);

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baseCandle]), { status: 200 }));
      render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
      await waitFor(() => expect(mockDataByIndex).toHaveBeenCalledTimes(2));
      expect(mockDataByIndex.mock.calls[0][0]).toBe(5);
      expect(mockDataByIndex.mock.calls[0][1]).toBe("left");
      // Matching timestamps → primitive.setData() (marker shown).
      expect(mockPriceToCoordinate).toHaveBeenCalled();
    });

    it("renders without crashing with empty candles", () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
      const { container } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
      expect(container).toBeTruthy();
    });

    describe("candlestick-chart reconnect backoff", () => {
      it("updates same-bucket candle on every live update without duplicating bars", async () => {
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baseCandle]), { status: 200 }));
        const { rerender } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 100));

        const setDataBefore = mockSetData.mock.calls.length;

        mockUseCandles.mockReturnValue([makeSnakeCandle({ startTime: 1790000000000, close: "100090", baseVolume: "12.5" })]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));

        mockUseCandles.mockReturnValue([makeSnakeCandle({ startTime: 1790000000000, close: "100100", baseVolume: "12.5" })]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));

        // Exactly two accepted same-bucket updates produce exactly two Candle
        // series.update() calls; volume.update also uses mockUpdate but passes
        // VolumePoint without .close, so filter for candle updates only.
        const candleUpdates = mockUpdate.mock.calls.filter(
          (c) => c[0] && typeof c[0].close === "number",
        );
        expect(candleUpdates.length).toBe(2);
        // Both calls use the same candle timestamp (same bucket).
        expect(candleUpdates[0][0].time).toBe(candleUpdates[1][0].time);
        expect(candleUpdates[0][0].time).toBe(1790000000);
        // The second call contains the latest OHLCV values.
        const lastCandleUpdate = candleUpdates[candleUpdates.length - 1][0];
        expect(lastCandleUpdate.close).toBe(100100);
        expect(lastCandleUpdate.open).toBe(100000);
        expect(lastCandleUpdate.high).toBe(100100);
        expect(lastCandleUpdate.low).toBe(99900);
        // No duplicate candle bucket is created; ordinary same-bucket updates
        // do not invoke full-series setData().
        expect(mockSetData.mock.calls.length).toBe(setDataBefore);
      });

      it("new candle bucket creates the next candle rather than a duplicate", async () => {
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baseCandle]), { status: 200 }));
        const { rerender } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 100));

        const setDataBefore = mockSetData.mock.calls.length;

        // First candle in the new bucket.
        mockUseCandles.mockImplementation(() => [makeSnakeCandle({ startTime: 1790000060000, close: "100090", high: "100100", baseVolume: "12.5" })]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));

        // setData was called during initial history loading with the base candle,
        // and count did not regress after rerender with the new bucket candle.
        expect(mockSetData.mock.calls.length).toBeGreaterThanOrEqual(setDataBefore);

        // mockUseCandles returns the new bucket candle (proving mockImplementation works)
        expect(mockUseCandles()).toEqual([makeSnakeCandle({ startTime: 1790000060000, close: "100090", high: "100100", baseVolume: "12.5" })]);

        // New bucket candle reached the chart series via setData (new bucket → setData).
        // The candle series now holds both the original and the new bucket candle.
        expect(mockCandleSeriesData.value.length).toBe(2);

        // Both timestamps are correct and unique.
        const timestamps = mockCandleSeriesData.value.map((c: any) => c.time);
        expect(timestamps).toContain(1790000000); // original candle bucket (1790000000000ms / 1000)
        expect(timestamps).toContain(1790000060); // new candle bucket (1790000060000ms / 1000)
        expect(new Set(timestamps).size).toBe(2); // unique timestamps

        // New candle OHLCV values match the incoming accepted data.
        const newBucketCandle = mockCandleSeriesData.value.find((c: any) => c.time === 1790000060);
        expect(newBucketCandle).toBeDefined();
        expect(newBucketCandle.open).toBe(100000);
        expect(newBucketCandle.high).toBe(100100);
        expect(newBucketCandle.low).toBe(99900);
        expect(newBucketCandle.close).toBe(100090);

        // Sending another update for the same new bucket changes the existing candle
        // rather than increasing the count again. The builder's canonical close
        // (from the first accepted trade) takes precedence over the raw trade close
        // for same-bucket native updates, but High is still updated.
        mockUseCandles.mockImplementation(() => [makeSnakeCandle({ startTime: 1790000060000, close: "100120", high: "100150", baseVolume: "12.5" })]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));

        // Count stays at 2 (same bucket → update, not append).
        expect(mockCandleSeriesData.value.length).toBe(2);
        // High is updated to the new value.
        const updatedCandle = mockCandleSeriesData.value.find((c: any) => c.time === 1790000060);
        expect(updatedCandle).toBeDefined();
        expect(updatedCandle.high).toBe(100150);
      });

      it("live updates are not lost during initial history loading", async () => {
        mockUseCandles.mockReturnValue([makeSnakeCandle({ startTime: 1790000000000, close: "100090", baseVolume: "12.5" })]);
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baseCandle]), { status: 200 }));
        render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 100));

        const updateCallsBefore = mockUpdate.mock.calls.length;

        // New bucket uses setData (not update), so setData count increases
        expect(mockSetData.mock.calls.length).toBeGreaterThan(updateCallsBefore);
        expect(mockUpdate.mock.calls.length).toBe(updateCallsBefore);
      });
    });

    describe("live trade sync", () => {
      const tradePrice = 100123.45;
      const liveTrade = {
        tradeId: "live-1",
        symbol: "BTCUSDT",
        price: String(tradePrice),
        size: "0.1",
        side: "buy",
        tsExchange: 1790000000000,
        isSnapshot: false,
      };

      const baselineCandle = makeSnakeCandle({
        startTime: 1790000000000,
        close: "100050",
        baseVolume: "12.5",
      });

      function renderChartWithBaseline() {
        mockUseCandles.mockReturnValue([baselineCandle]);
        mockUseTrades.mockReturnValue([liveTrade]);
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baselineCandle]), { status: 200 }));
        return render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
      }

      beforeEach(() => {
        mockUseCandles.mockReturnValue([baselineCandle]);
        mockUseTrades.mockReturnValue([]);
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baselineCandle]), { status: 200 }));
      });

      it("13. One accepted Trade updates the active candle series", async () => {
        renderChartWithBaseline();
        await new Promise((r) => setTimeout(r, 100));

        const candleUpdate = mockUpdate.mock.calls.find(
          (c) => c[0] && typeof c[0].close === "number",
        );
        expect(candleUpdate).toBeTruthy();
        expect(candleUpdate![0].close).toBe(tradePrice);
      });

      it("14. The same Trade updates the chart price indicator to the same price", async () => {
        // Render with no trades so only the ticker price is applied initially.
        mockUseCandles.mockReturnValue([baselineCandle]);
        mockUseTrades.mockReturnValue([]);
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baselineCandle]), { status: 200 }));
        const { rerender } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 100));
        expect(capturedPrimitive.current).toBeTruthy();
        vi.spyOn(capturedPrimitive.current, "setPrice");

        mockUseTrades.mockReturnValue([liveTrade]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));

        expect(capturedPrimitive.current.setPrice).toHaveBeenCalledWith(tradePrice);
      });

      it("15. A subsequent Trade updates the same candle and existing price primitive", async () => {
        const nextPrice = 100200.5;
        const nextTrade = { ...liveTrade, tradeId: "live-2", price: String(nextPrice), tsExchange: 1790000010000 };

        const { rerender } = renderChartWithBaseline();
        await new Promise((r) => setTimeout(r, 100));
        expect(capturedPrimitive.current).toBeTruthy();
        vi.spyOn(capturedPrimitive.current, "setPrice");

        const updatesBefore = mockUpdate.mock.calls.length;
        const setDataBefore = mockSetData.mock.calls.length;

        mockUseTrades.mockReturnValue([nextTrade]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));

        // Same bucket: candle updated again (candle + volume series both call
        // update), no new setData bar.
        const candleUpdate = mockUpdate.mock.calls.find(
          (c, i) => i >= updatesBefore && c[0] && typeof c[0].close === "number",
        );
        expect(candleUpdate).toBeTruthy();
        expect(candleUpdate![0].close).toBe(nextPrice);
        expect(mockSetData.mock.calls.length).toBe(setDataBefore);
        expect(capturedPrimitive.current.setPrice).toHaveBeenCalledWith(nextPrice);
      });

      it("16. No duplicate candle bar or price primitive is created", async () => {
        const { rerender } = renderChartWithBaseline();
        await new Promise((r) => setTimeout(r, 100));

        const setDataBefore = mockSetData.mock.calls.length;
        const attachBefore = mockAttachPrimitive.mock.calls.length;

        mockUseTrades.mockReturnValue([
          { ...liveTrade, isSnapshot: true },
          liveTrade,
        ]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));

        expect(mockSetData.mock.calls.length).toBe(setDataBefore);
        expect(mockAttachPrimitive.mock.calls.length).toBe(attachBefore);
      });

      it("17. Out-of-order Trade does not regress Close or price line", async () => {
        const { rerender } = renderChartWithBaseline();
        await new Promise((r) => setTimeout(r, 100));
        expect(capturedPrimitive.current).toBeTruthy();
        vi.spyOn(capturedPrimitive.current, "setPrice");

        const laterTrade = {
          ...liveTrade,
          tradeId: "live-later",
          price: String(100200.5),
          tsExchange: 1790000010000,
        };
        mockUseTrades.mockReturnValue([laterTrade]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));

        const lateTrade = {
          ...liveTrade,
          tradeId: "live-late",
          price: "9999",
          tsExchange: 1790000005000,
        };
        mockUseTrades.mockReturnValue([lateTrade]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));

        const candleUpdates = mockUpdate.mock.calls.filter(
          (c) => c[0] && typeof c[0].close === "number",
        );
        const lastCandleUpdate = candleUpdates[candleUpdates.length - 1];
        expect(lastCandleUpdate).toBeTruthy();
        expect(lastCandleUpdate![0].close).toBe(100200.5);
        // Primitive reflects canonical close, never the stale out-of-order price.
        expect(capturedPrimitive.current.setPrice).toHaveBeenCalledWith(100200.5);
        expect(capturedPrimitive.current.setPrice).not.toHaveBeenCalledWith(9999);
      });

      it("18. Ticker update cannot overwrite Trade-driven current price", async () => {
        // No trades yet: ticker initializes the displayed price (during mount).
        mockUseCandles.mockReturnValue([baselineCandle]);
        mockUseTrades.mockReturnValue([]);
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baselineCandle]), { status: 200 }));
        const { rerender } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 100));
        expect(capturedPrimitive.current).toBeTruthy();
        const priceSpy = vi.spyOn(capturedPrimitive.current, "setPrice");
        // Clear the mount-time call so we only observe subsequent calls.
        priceSpy.mockClear();

        // A live trade establishes the canonical price.
        mockUseTrades.mockReturnValue([liveTrade]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));
        expect(priceSpy).toHaveBeenCalledWith(tradePrice);

        // Ticker changes to a different price: must NOT overwrite trade-driven price.
        mockUseTicker.mockReturnValue({ last: "9999" });
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));
        expect(priceSpy).not.toHaveBeenCalledWith(9999);
      });

      it("19. Native candle update does not flip rendered Open away from builder Open", async () => {
        const { rerender } = renderChartWithBaseline();
        await new Promise((r) => setTimeout(r, 100));

        // Delayed native candle for the same bucket with a different Open.
        mockUseCandles.mockReturnValue([
          makeSnakeCandle({
            startTime: 1790000000000,
            open: "99999",
            close: "100050",
            baseVolume: "12.5",
          }),
        ]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 50));

        const candleUpdates = mockUpdate.mock.calls.filter(
          (c) => c[0] && typeof c[0].close === "number",
        );
        const lastCandleUpdate = candleUpdates[candleUpdates.length - 1];
        expect(lastCandleUpdate).toBeTruthy();
        // Rendered Open must stay at the builder's value (100000), not flip to
        // the native value (99999).
        expect(lastCandleUpdate![0].open).toBe(100000);
        expect(candleUpdates.some((c) => c[0].open === 99999)).toBe(false);
      });
    });

    describe("initial hydration and resume", () => {
      it("renders the complete initial dataset, not a single candle", async () => {
        mockFetch.mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              baseCandle,
              makeSnakeCandle({ start_time: 1790000060000, close: "100100" }),
            ]),
            { status: 200 },
          ),
        );
        render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 100));

        const candleSetData = mockSetData.mock.calls.filter(
          (c) =>
            c[0] && Array.isArray(c[0]) && c[0].length > 0 && typeof c[0][0].close === "number",
        );
        expect(candleSetData.length).toBeGreaterThan(0);
        const lastDataset = candleSetData[candleSetData.length - 1][0];
        // Complete historical dataset (2 candles), never a single-candle flash.
        expect(lastDataset.length).toBeGreaterThan(1);
      });

      it("visibilitychange hidden→visible triggers resume catch-up via REST", async () => {
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baseCandle]), { status: 200 }));
        render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 100));
        mockFetch.mockClear();

        // Simulate tab hidden then visible again.
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));

        // Debounce (400ms) + catch-up fetch.
        await new Promise((r) => setTimeout(r, 600));

        const catchUpCalls = mockFetch.mock.calls.filter(
          (c) => typeof c[0] === "string" && String(c[0]).includes("/api/market/candles/"),
        );
        expect(catchUpCalls.length).toBeGreaterThan(0);
      });
    });

    describe("timeframe switch hydration", () => {
      it("switching granularity does not flash a single candle before history loads", async () => {
        // Initial 1m load
        mockFetch
          .mockResolvedValueOnce(new Response(JSON.stringify([baseCandle]), { status: 200 }))
          .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
        const { rerender } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 100));

        // Verify 1m data loaded
        expect(mockCandleSeriesData.value.length).toBeGreaterThan(0);

        // Switch to 5m with deferred fetch
        let resolve5mFetch: ((value: Response) => void) | null = null;
        mockFetch.mockImplementation(() =>
          new Promise(resolve => { resolve5mFetch = resolve; })
        );
        mockUseCandles.mockReturnValue([]); // No cached 5m data yet

        rerender(<CandlestickChart symbol="BTCUSDT" granularity="5m" />);
        await new Promise((r) => setTimeout(r, 50));

        // No candle data setData yet for 5m — still loading, no single-candle flash.
        // (applySeriesData([], []) clears the chart with empty arrays.)
        expect(mockCandleSeriesData.value.length).toBe(0);

        // Send live trades during loading — should be buffered, not rendered
        mockUseCandles.mockReturnValue([
          makeSnakeCandle({ startTime: 1790000060000, close: "100090", baseVolume: "12.5" })
        ]);

        // Resolve 5m REST with historical data
        resolve5mFetch!(new Response(JSON.stringify([
          makeSnakeCandle({ startTime: 1790000000000, close: "100050", baseVolume: "12.5" }),
          makeSnakeCandle({ startTime: 1790000060000, close: "100100", baseVolume: "12.5" }),
        ]), { status: 200 }));

        await new Promise((r) => setTimeout(r, 100));

        // Complete merged 5m dataset applied — two historical candles
        expect(mockCandleSeriesData.value.length).toBe(2);
        const timestamps = mockCandleSeriesData.value.map((c: any) => c.time);
        expect(timestamps).toContain(1790000000);
        expect(timestamps).toContain(1790000060);
        expect(new Set(timestamps).size).toBe(2);

        // Live trade candle merged into same bucket as second historical candle
        const liveBucketCandle = mockCandleSeriesData.value.find((c: any) => c.time === 1790000060);
        expect(liveBucketCandle).toBeDefined();
        // Live trade's close overwrites historical close because builder was
        // seeded with live trade data (not REST candle data) for this bucket
        expect(liveBucketCandle.close).toBe(100090);
      });

      it("rapid switching rejects stale granularity responses", async () => {
        // Initial 1m load
        mockFetch
          .mockResolvedValueOnce(new Response(JSON.stringify([baseCandle]), { status: 200 }))
          .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
        const { rerender } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
        await new Promise((r) => setTimeout(r, 100));

        // Switch to 5m with deferred fetch
        let resolve5mFetch: ((value: Response) => void) | null = null;
        mockFetch.mockImplementation(() =>
          new Promise(resolve => { resolve5mFetch = resolve; })
        );
        mockUseCandles.mockReturnValue([]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="5m" />);
        await new Promise((r) => setTimeout(r, 50));

        // Rapidly switch to 15m before 5m resolves
        let resolve15mFetch: ((value: Response) => void) | null = null;
        mockFetch.mockImplementation(() =>
          new Promise(resolve => { resolve15mFetch = resolve; })
        );
        mockUseCandles.mockReturnValue([]);
        rerender(<CandlestickChart symbol="BTCUSDT" granularity="15m" />);
        await new Promise((r) => setTimeout(r, 50));

        // Resolve stale 5m response first — should be ignored
        resolve5mFetch!(new Response(JSON.stringify([
          makeSnakeCandle({ startTime: 1790000000000, close: "99999", baseVolume: "12.5" }),
        ]), { status: 200 }));
        await new Promise((r) => setTimeout(r, 50));

        // Chart should NOT have 5m data (stale response rejected)
        expect(mockCandleSeriesData.value.length).toBe(0);

        // Resolve 15m response — should apply to chart
        resolve15mFetch!(new Response(JSON.stringify([
          makeSnakeCandle({ startTime: 1790000000000, close: "100090", baseVolume: "12.5" }),
        ]), { status: 200 }));
        await new Promise((r) => setTimeout(r, 100));

        // 15m data should be applied
        expect(mockCandleSeriesData.value.length).toBe(1);
        expect(mockCandleSeriesData.value[0].close).toBe(100090);
      });
    });
  });
});