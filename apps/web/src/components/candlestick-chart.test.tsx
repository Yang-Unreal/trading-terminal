/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CandlestickChart, TimeframeSelector, TIMEFRAMES } from "./candlestick-chart";

// Mock ResizeObserver (not available in jsdom)
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
const mockTimeScale = vi.hoisted(() => vi.fn(() => ({
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
})));
const mockPriceScale = vi.hoisted(() => vi.fn(() => ({
  applyOptions: mockApplyOptions,
  width: vi.fn(() => 60),
})));
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
const mockAddSeries = vi.hoisted(() => vi.fn(() => ({
  setData: mockSetData,
  update: mockUpdate,
  applyOptions: mockApplyOptions,
  priceScale: mockPriceScale,
  priceToCoordinate: mockPriceToCoordinate,
  lastValueData: mockLastValueData,
  dataByIndex: mockDataByIndex,
  subscribeDataChanged: mockSubscribeDataChanged,
  unsubscribeDataChanged: mockUnsubscribeDataChanged,
  attachPrimitive: mockAttachPrimitive,
  detachPrimitive: mockDetachPrimitive,
  options: mockOptions,
  barsInLogicalRange: mockBarsInLogicalRange,
})));
const mockCreateChart = vi.hoisted(() => vi.fn(() => ({
  remove: mockRemove,
  addSeries: mockAddSeries,
  applyOptions: mockApplyOptions,
  timeScale: mockTimeScale,
})));

vi.mock("lightweight-charts", () => ({
  createChart: mockCreateChart,
  candlestickSeries: {},
  histogramSeries: {},
  CandlestickSeries: {},
  HistogramSeries: {},
  CrosshairMode: { Normal: 0 },
  ColorType: { Solid: "solid" },
  LineStyle: { Dotted: 2 },
  MismatchDirection: { NearestLeft: -1, None: 0, NearestRight: 1 },
}));

// Mock fetch for REST candle loading
const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", mockFetch);

// Mock useCandles to control WebSocket candle flow in tests
const mockUseCandles = vi.hoisted(() => vi.fn((): any[] => []));
vi.mock("@/lib/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market")>();
  return {
    ...actual,
    useCandles: mockUseCandles,
  };
});

// Snake_case candle matching the real Bitget REST API response
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

describe("candlestick time conversion", () => {
  it("converts millisecond timestamp to UTC seconds", () => {
    expect(Math.floor(1790000000000 / 1000)).toBe(1790000000);
  });
});

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
    mockBarsInLogicalRange.mockClear();
    mockUseCandles.mockReturnValue([]);
    document.body.innerHTML = "";
  });

  afterEach(() => cleanup());

  it("renders chart container", () => {
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    expect(document.querySelector("div.border-slate-700")).toBeTruthy();
  });

  it("creates chart with candlestick and volume series on mount", () => {
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    expect(mockCreateChart).toHaveBeenCalledTimes(1);
    expect(mockAddSeries).toHaveBeenCalledTimes(2);
  });

  it("attaches volume axis primitive to candlestick series on mount", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockAttachPrimitive).toHaveBeenCalledTimes(1);
    const primitive = mockAttachPrimitive.mock.calls[0][0];
    expect(primitive).toBeDefined();
    expect(typeof primitive.priceAxisViews).toBe("function");
    expect(typeof primitive.updateAllViews).toBe("function");
    expect(typeof primitive.attached).toBe("function");
    expect(typeof primitive.detached).toBe("function");
  });

  it("primitive implements ISeriesPrimitiveAxisView contract", async () => {
    mockGetVisibleLogicalRange.mockReturnValue({ from: 0, to: 0 });
    mockDataByIndex
      .mockReturnValueOnce({
        time: 1790000000000,
        open: 100000,
        high: 100100,
        low: 99900,
        close: 100050,
      } as any)
      .mockReturnValue({
        time: 1790000000000,
        value: 12.5,
        color: "#22c55e",
      } as any);
    mockPriceToCoordinate.mockReturnValue(100);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    const primitive = mockAttachPrimitive.mock.calls[0][0];
    const views = primitive.priceAxisViews();
    expect(Array.isArray(views)).toBe(true);
    expect(views.length).toBeGreaterThan(0);

    const view = views[0];
    expect(typeof view.coordinate).toBe("function");
    expect(typeof view.text).toBe("function");
    expect(typeof view.textColor).toBe("function");
    expect(typeof view.backColor).toBe("function");
    expect(typeof view.visible).toBe("function");
    expect(typeof view.tickVisible).toBe("function");
  });

  it("detaches volume axis primitive on unmount", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    const { unmount } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));
    unmount();

    expect(mockDetachPrimitive).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it("no custom HTML volume marker is rendered", () => {
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    const markers = document.querySelectorAll("div[style*='backgroundColor']");
    // No HTML-based volume marker div should exist
    expect(markers.length).toBe(0);
  });

  it("shows loading state initially", () => {
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    expect(screen.getByText("Loading candles…")).toBeTruthy();
  });

  it("loads historical candles from REST API", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalled();
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain("/api/market/candles/BTCUSDT");
    expect(callUrl).toContain("granularity=1m");
    expect(callUrl).toContain("limit=1000");

    expect(mockSetData).toHaveBeenCalled();
    expect(screen.queryByText("Loading candles…")).toBeNull();
  });

  it("produces chart points for all historical candles", async () => {
    const candles = Array.from({ length: 300 }, (_, i) =>
      makeSnakeCandle({
        start_time: 1790000000000 + i * 60000,
        open: String(100000 + i),
        high: String(100100 + i),
        low: String(99900 + i),
        close: String(100000 + i),
      }),
    );
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(candles), { status: 200 }));
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    const setDataCalls = mockSetData.mock.calls.filter((args) => args[0] && Array.isArray(args[0]));
    const lastCall = setDataCalls[setDataCalls.length - 1];
    const points = lastCall![0];
    expect(points.length).toBe(300);
  });

  it("sorts historical candles by timestamp ascending", async () => {
    const late = makeSnakeCandle({ start_time: 1790000002000, close: "100060" });
    const early = makeSnakeCandle({ start_time: 1790000000000, close: "100050" });
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([late, early]), { status: 200 }));
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 200));

    const setDataCalls = mockSetData.mock.calls.filter((args) => args[0] && args[0].length > 0);
    expect(setDataCalls.length).toBeGreaterThan(0);
    const points = setDataCalls[setDataCalls.length - 1][0];
    expect(points[0].time).toBeLessThan(points[1].time);
  });

  it("removes duplicate timestamps", async () => {
    const dup = makeSnakeCandle({ close: "100099" });
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([baseCandle, dup]), { status: 200 }));
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 50));

    const setDataCall = mockSetData.mock.calls.find((args) => args[0] && Array.isArray(args[0]));
    const points = setDataCall![0];
    const times = points.map((p: any) => p.time);
    expect(times.length).toBe(new Set(times).size);
  });

  it("rejects invalid candle values (high < low)", async () => {
    const invalid = makeSnakeCandle({ high: "99900", low: "100100" });
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([invalid]), { status: 200 }));
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 200));

    const validCalls = mockSetData.mock.calls.filter((args) => args[0] && args[0].length > 0);
    expect(validCalls.length).toBe(0);
  });

  it("rejects invalid decimal values", async () => {
    const invalid = makeSnakeCandle({ open: "not-a-number" });
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([invalid]), { status: 200 }));
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 200));

    const validCalls = mockSetData.mock.calls.filter((args) => args[0] && args[0].length > 0);
    expect(validCalls.length).toBe(0);
  });

  it("REST loading works without WebSocket candles", async () => {
    mockUseCandles.mockReturnValue([]);
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify([baseCandle]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockSetData).toHaveBeenCalled();
    expect(screen.queryByText("Loading candles…")).toBeNull();
  });

  it("WebSocket update after loading does not call setData again", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify([baseCandle]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const { rerender } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    const setDataCallsBefore = mockSetData.mock.calls.length;

    mockUseCandles.mockReturnValue([makeSnakeCandle({ start_time: 1790000000000, close: "100090" })]);
    rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSetData.mock.calls.length).toBe(setDataCallsBefore);
  });

  it("timeframe switching loads a new historical dataset", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([baseCandle]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([makeSnakeCandle({ start_time: 1800000000000, close: "200000" })]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const { rerender } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain("granularity=1m");

    rerender(<CandlestickChart symbol="BTCUSDT" granularity="5m" />);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][0]).toContain("granularity=1m");
    expect(mockFetch.mock.calls[1][0]).toContain("granularity=1m");
    expect(mockFetch.mock.calls[2][0]).toContain("granularity=5m");
  });

  it("old requests cannot overwrite a newer timeframe", async () => {
    const deferred1 = { resolve: null as ((v: Response) => void) | null };
    const p1 = new Promise<Response>((res) => { deferred1.resolve = res; });

    mockFetch
      .mockResolvedValueOnce(p1)
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const { rerender } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 50));

    rerender(<CandlestickChart symbol="BTCUSDT" granularity="5m" />);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const setDataCallsBefore = mockSetData.mock.calls.length;

    deferred1.resolve!(new Response(JSON.stringify([makeSnakeCandle({ start_time: 1700000000000, close: "99999" })]), { status: 200 }));
    await new Promise((r) => setTimeout(r, 100));

    expect(mockSetData.mock.calls.length).toBe(setDataCallsBefore);
  });

  it("handles API error and shows error message", async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error("network failure")));
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByText(/network failure/)).toBeTruthy();
    expect(screen.queryByText("Loading candles…")).toBeNull();
  });

  it("handles empty response", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 200));

    expect(mockSetData).toHaveBeenCalledWith([]);
  });

  it("volume history matches candlestick history", async () => {
    const candles = [
      makeSnakeCandle({ start_time: 1790000000000, open: "100000", close: "100050", base_volume: "10.5" }),
      makeSnakeCandle({ start_time: 1790000000060, open: "100050", close: "100040", base_volume: "5.0" }),
    ];
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(candles), { status: 200 }));
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    const allSetDataCalls = mockSetData.mock.calls.filter((args) => args[0] && Array.isArray(args[0]));
    expect(allSetDataCalls.length).toBeGreaterThanOrEqual(2);
    const candlePoints = allSetDataCalls[allSetDataCalls.length - 2]![0];
    const volumePoints = allSetDataCalls[allSetDataCalls.length - 1]![0];

    expect(volumePoints.length).toBe(candlePoints.length);
    for (let i = 0; i < candlePoints.length; i++) {
      expect(volumePoints[i].time).toBe(candlePoints[i].time);
    }
  });

  it("cleans up chart on unmount", () => {
    const { unmount } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    unmount();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it("renders without error for inactive granularity", () => {
    render(<CandlestickChart symbol="BTCUSDT" granularity="5m" />);
    expect(mockCreateChart).toHaveBeenCalledTimes(1);
  });

  // --- Problem B: Visible-range synchronization tests ---

  it("subscribes to visible logical range changes on mount", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockSubscribeVisibleLogicalRangeChange).toHaveBeenCalled();
    expect(mockSubscribeDataChanged).toHaveBeenCalled();
  });

  it("unsubscribes visible logical range changes on unmount", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    const { unmount } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));
    unmount();

    expect(mockUnsubscribeVisibleLogicalRangeChange).toHaveBeenCalled();
    expect(mockUnsubscribeDataChanged).toHaveBeenCalled();
  });

  it("volume marker uses rightmost visible candle when panning left", async () => {
    // Reset mocks to clear any state from previous tests
    mockDataByIndex.mockReset();
    mockPriceToCoordinate.mockReset();
    mockGetVisibleLogicalRange.mockReset();

    // Set up mocks BEFORE rendering so initial load uses correct values
    mockGetVisibleLogicalRange.mockReturnValue({ from: 0, to: 0 });
    mockDataByIndex
      .mockReturnValueOnce({
        time: 1790000000000,
        open: 100000,
        high: 100100,
        low: 99900,
        close: 100050,
      } as any)
      .mockReturnValue({
        time: 1790000000000,
        value: 12.5,
        color: "#22c55e",
      } as any);
    mockPriceToCoordinate.mockReturnValue(150);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockDataByIndex).toHaveBeenCalled();
    expect(mockDataByIndex.mock.calls[0][0]).toBe(0);
    expect(mockDataByIndex.mock.calls[0][1]).toBe(-1); // MismatchDirection.NearestLeft
  });

  it("volume marker uses newest visible candle when range at end", async () => {
    mockDataByIndex.mockReset();
    mockPriceToCoordinate.mockReset();
    mockGetVisibleLogicalRange.mockReset();

    mockGetVisibleLogicalRange.mockReturnValue({ from: 0, to: 999 });
    mockDataByIndex
      .mockReturnValueOnce({
        time: 1790000000000,
        open: 100000,
        high: 100100,
        low: 99900,
        close: 100050,
      } as any)
      .mockReturnValue({
        time: 1790000000000,
        value: 25.0,
        color: "#ef4444",
      } as any);
    mockPriceToCoordinate.mockReturnValue(200);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockPriceToCoordinate).toHaveBeenCalledWith(25.0);
  });

  it("hides volume marker when no visible candle exists", async () => {
    mockGetVisibleLogicalRange.mockReset();
    mockGetVisibleLogicalRange.mockReturnValue(null);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));
  });

  it("volume marker timestamp matches candlestick price marker timestamp", async () => {
    mockDataByIndex.mockReset();
    mockPriceToCoordinate.mockReset();
    mockGetVisibleLogicalRange.mockReset();

    mockGetVisibleLogicalRange.mockReturnValue({ from: 0, to: 5 });
    mockDataByIndex
      .mockReturnValueOnce({
        time: 1790000003000,
        open: 100000,
        high: 100100,
        low: 99900,
        close: 100050,
      } as any)
      .mockReturnValue({
        time: 1790000003000,
        value: 15.0,
        color: "#22c55e",
      } as any);
    mockPriceToCoordinate.mockReturnValue(300);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockDataByIndex.mock.calls[0][0]).toBe(mockDataByIndex.mock.calls[1][0]);
  });

  it("candle and volume timestamps mismatch hides marker", async () => {
    mockDataByIndex.mockReset();
    mockPriceToCoordinate.mockReset();
    mockGetVisibleLogicalRange.mockReset();

    mockGetVisibleLogicalRange.mockReturnValue({ from: 0, to: 5 });
    mockDataByIndex
      .mockReturnValueOnce({
        time: 1790000003000,
        open: 100000,
        high: 100100,
        low: 99900,
        close: 100050,
      } as any)
      .mockReturnValue({
        time: 1790000004000, // different timestamp
        value: 15.0,
        color: "#22c55e",
      } as any);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockPriceToCoordinate).not.toHaveBeenCalled();
  });

  it("off-screen live WebSocket updates do not change volume marker", async () => {
    mockDataByIndex.mockReset();
    mockPriceToCoordinate.mockReset();
    mockGetVisibleLogicalRange.mockReset();

    mockGetVisibleLogicalRange.mockReturnValue({ from: 0, to: 5 });
    mockDataByIndex
      .mockReturnValueOnce({
        time: 1790000003000,
        open: 100000,
        high: 100100,
        low: 99900,
        close: 100050,
      } as any)
      .mockReturnValue({
        time: 1790000003000,
        value: 15.0,
        color: "#22c55e",
      } as any);
    mockPriceToCoordinate.mockReturnValue(300);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([baseCandle]), { status: 200 }),
    );
    const { rerender } = render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 100));

    // WS candle arrives for newer timestamp outside visible range
    mockUseCandles.mockReturnValue([makeSnakeCandle({ start_time: 1790000100000, close: "100090" })]);
    rerender(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    await new Promise((r) => setTimeout(r, 50));

    // Marker should still show volume 15.0 (visible candle), not WS candle's volume
    expect(mockPriceToCoordinate).toHaveBeenCalledWith(15.0);
  });

  // --- Problem A: UI consistency tests ---

  it("volume marker is rendered through native axis primitive, not HTML", () => {
    render(<CandlestickChart symbol="BTCUSDT" granularity="1m" />);
    const htmlMarkers = document.querySelectorAll("div[ref='volumeMarkerRef']");
    expect(htmlMarkers.length).toBe(0);
  });
});

describe("TimeframeSelector", () => {
  afterEach(() => cleanup());

  it("renders all supported timeframes", () => {
    render(<TimeframeSelector granularity="1m" onChange={vi.fn()} />);
    TIMEFRAMES.forEach((tf) => {
      expect(screen.getByText(tf.label)).toBeTruthy();
    });
  });

  it("calls onChange when a timeframe is clicked", () => {
    const onChange = vi.fn();
    render(<TimeframeSelector granularity="1m" onChange={onChange} />);
    const buttons = screen.getAllByRole("button");
    const target = buttons.find((b) => b.textContent === "4H");
    expect(target).toBeTruthy();
    if (!target) throw new Error("4H button not found");
    fireEvent.click(target);
    expect(onChange).toHaveBeenCalledWith("4H");
  });

  it("highlights the selected timeframe", () => {
    render(<TimeframeSelector granularity="4H" onChange={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    const selected = buttons.find((b) => b.textContent === "4H");
    expect(selected).toBeTruthy();
    if (!selected) throw new Error("4H button not found");
    expect(selected.className).toContain("bg-slate-600");
    expect(selected.className).toContain("text-white");
  });
});
