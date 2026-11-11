/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CurrentPricePrimitive } from "./candlestick-chart";

const NEUTRAL_COLOR = "#cbd5e1";
const BULLISH_COLOR = "#22c55e";
const BEARISH_COLOR = "#ef4444";
const NEUTRAL_TEXT = "#0f172a";
const DIRECTION_TEXT = "#ffffff";

function makePrimitive(
  priceToCoordinate: (price: number) => number,
  openRef?: { current: number | null },
): CurrentPricePrimitive {
  const candleSeries = { priceToCoordinate } as any;
  const candleOpenRef = openRef ?? { current: null };
  return new CurrentPricePrimitive({ current: candleSeries }, candleOpenRef);
}

function makeFakeCtx() {
  let lineDash: number[] = [];
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    strokeStyle: "",
    lineWidth: 0,
    setLineDash: vi.fn((dash: number[]) => {
      lineDash = dash;
    }),
    getLineDash: vi.fn(() => lineDash),
    lineDashOffset: 0,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as any;
  const target: any = {
    useBitmapCoordinateSpace: (func: any) =>
      func({ context: ctx, verticalPixelRatio: 1, bitmapSize: { width: 1000, height: 600 } }),
  };
  return { ctx, target };
}

describe("CurrentPricePrimitive — candle direction color", () => {
  it("equal open/close → neutral grey-white", () => {
    const openRef = { current: 100 };
    const prim = makePrimitive((p) => p * 10, openRef);
    prim.setPrice(100);
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].backColor()).toBe(NEUTRAL_COLOR);
    expect(prim.priceAxisViews()[0].textColor()).toBe(NEUTRAL_TEXT);
  });

  it("close above open → green", () => {
    const openRef = { current: 100 };
    const prim = makePrimitive((p) => p * 10, openRef);
    prim.setPrice(100.1);
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].backColor()).toBe(BULLISH_COLOR);
    expect(prim.priceAxisViews()[0].textColor()).toBe(DIRECTION_TEXT);
  });

  it("close above open repeatedly → stays green", () => {
    const openRef = { current: 100 };
    const prim = makePrimitive((p) => p * 10, openRef);
    prim.setPrice(100.5);
    prim.setPrice(100.2); // still above open → green
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].backColor()).toBe(BULLISH_COLOR);
  });

  it("price decreases but remains above open → still green", () => {
    const openRef = { current: 100 };
    const prim = makePrimitive((p) => p * 10, openRef);
    prim.setPrice(100.5); // green
    prim.setPrice(100.2); // fell, but still above open → green
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].backColor()).toBe(BULLISH_COLOR);
  });

  it("close below open → red", () => {
    const openRef = { current: 100 };
    const prim = makePrimitive((p) => p * 10, openRef);
    prim.setPrice(99.9);
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].backColor()).toBe(BEARISH_COLOR);
    expect(prim.priceAxisViews()[0].textColor()).toBe(DIRECTION_TEXT);
  });

  it("close below open repeatedly → stays red", () => {
    const openRef = { current: 100 };
    const prim = makePrimitive((p) => p * 10, openRef);
    prim.setPrice(99.5);
    prim.setPrice(99.8); // rose, but still below open → red
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].backColor()).toBe(BEARISH_COLOR);
  });

  it("price increases but remains below open → still red", () => {
    const openRef = { current: 100 };
    const prim = makePrimitive((p) => p * 10, openRef);
    prim.setPrice(99.5); // red
    prim.setPrice(99.9); // rose, still below open → red
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].backColor()).toBe(BEARISH_COLOR);
  });

  it("close returns to open → neutral", () => {
    const openRef = { current: 100 };
    const prim = makePrimitive((p) => p * 10, openRef);
    prim.setPrice(100.5); // green
    prim.setPrice(100); // back to open → neutral
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].backColor()).toBe(NEUTRAL_COLOR);
  });

  it("no valid open → neutral", () => {
    const prim = makePrimitive((p) => p * 10);
    prim.setPrice(100);
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].backColor()).toBe(NEUTRAL_COLOR);
  });

  it("label and line use exactly the same Y coordinate", () => {
    const priceToCoordinate = vi.fn((p: number) => p * 2.5);
    const prim = makePrimitive(priceToCoordinate);
    prim.setPrice(100);
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].coordinate()).toBe(250);
  });

  it("price-scale change recalculates Y without new ticker", () => {
    const priceToCoordinate = vi.fn((p: number) => p * 10);
    const prim = makePrimitive(priceToCoordinate);
    prim.setPrice(100);
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].coordinate()).toBe(1000);

    priceToCoordinate.mockImplementation((p) => p * 20);
    prim.updateAllViews();
    expect(prim.priceAxisViews()[0].coordinate()).toBe(2000);
    expect(priceToCoordinate).toHaveBeenLastCalledWith(100);
  });

  it("line drawn on pane canvas (stops at price-scale boundary)", () => {
    const prim = makePrimitive((p) => p * 10);
    prim.setPrice(100);
    prim.updateAllViews();
    const views = prim.paneViews();
    expect(views.length).toBe(1);
    expect(views[0].renderer()).not.toBeNull();
    expect(typeof views[0].zOrder).toBe("function");
  });
});

describe("CurrentPricePrimitive — line width and rendering", () => {
  it("fixed line width is used for every price", () => {
    const prim = makePrimitive((p) => p * 10);
    prim.setPrice(100);
    prim.updateAllViews();
    const { ctx, target } = makeFakeCtx();
    const renderer = prim.paneViews()[0].renderer()!;
    renderer.draw(target);
    expect(ctx.lineWidth).toBe(1);
  });

  it("dash pattern is consistent across prices", () => {
    const prim = makePrimitive((p) => p * 10);
    prim.setPrice(100);
    prim.updateAllViews();
    const { ctx, target } = makeFakeCtx();
    const renderer = prim.paneViews()[0].renderer()!;
    renderer.draw(target);
    expect(ctx.getLineDash()).toEqual([6, 4]);
  });

  it("different fractional Y coordinates produce consistent stroke width", () => {
    const prim = makePrimitive((p) => p * 10);
    prim.setPrice(100);
    prim.updateAllViews();
    const { ctx, target } = makeFakeCtx();
    const renderer = prim.paneViews()[0].renderer()!;
    for (const price of [100, 100.333, 100.666, 101]) {
      prim.setPrice(price);
      prim.updateAllViews();
      renderer.draw(target);
      expect(ctx.lineWidth).toBe(1);
    }
  });

  it("a single update does not accumulate dash state", () => {
    const prim = makePrimitive((p) => p * 10);
    prim.setPrice(100);
    prim.updateAllViews();
    const { ctx, target } = makeFakeCtx();
    const renderer = prim.paneViews()[0].renderer()!;
    renderer.draw(target);
    renderer.draw(target);
    expect(ctx.getLineDash()).toEqual([6, 4]);
    expect(ctx.lineDashOffset).toBe(0);
  });
});
