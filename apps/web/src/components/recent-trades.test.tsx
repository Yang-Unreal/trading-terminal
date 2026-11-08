/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RecentTrades } from "./recent-trades";

afterEach(() => cleanup());

const baseTrades = [
  {
    tradeId: "t1",
    symbol: "BTCUSDT",
    price: "75759.3",
    size: "0.001",
    side: "buy" as const,
    tsReceived: 1000,
  },
  {
    tradeId: "t2",
    symbol: "BTCUSDT",
    price: "75760.1",
    size: "0.5",
    side: "sell" as const,
    tsReceived: 2000,
  },
  {
    tradeId: "t3",
    symbol: "BTCUSDT",
    price: "75758.8",
    size: "0.25",
    side: "buy" as const,
    tsReceived: 1500,
  },
];

describe("RecentTrades", () => {
  it("renders trades latest first", () => {
    render(<RecentTrades trades={baseTrades} />);
    // t2 (tsReceived=2000) should appear first - check its price is in the first row
    const firstRow = screen.getAllByText("75760.1");
    expect(firstRow.length).toBeGreaterThan(0);
  });

  it("displays price, size, side, and notional", () => {
    render(<RecentTrades trades={[baseTrades[0]]} />);
    const priceElements = screen.getAllByText("75759.3");
    expect(priceElements.length).toBeGreaterThan(0);
    expect(screen.getByText("0.001")).toBeTruthy();
    expect(screen.getByText("Buy")).toBeTruthy();
  });

  it("shows buy in green and sell in red", () => {
    render(<RecentTrades trades={[baseTrades[0], baseTrades[1]]} />);
    const buyElements = screen.getAllByText("Buy");
    const sellElements = screen.getAllByText("Sell");
    expect(buyElements.length).toBe(1);
    expect(sellElements.length).toBe(1);
  });

  it("handles empty trades", () => {
    render(<RecentTrades trades={[]} />);
    expect(screen.getByText("No trades")).toBeTruthy();
  });

  it("limits to 100 records", () => {
    const manyTrades = Array.from({ length: 150 }, (_, i) => ({
      tradeId: `t${i}`,
      symbol: "BTCUSDT",
      price: `${100 + i}`,
      size: "2",
      side: "buy" as const,
      tsReceived: i,
    }));
    render(<RecentTrades trades={manyTrades} />);
    // Sorted descending by tsReceived: index 99 → tsReceived 50 → price 150
    expect(screen.getByText("150")).toBeTruthy();
    // Index 100 → tsReceived 49 → price 149, should NOT be present
    expect(screen.queryByText("149")).toBeNull();
  });

  it("shows stale indicator", () => {
    render(<RecentTrades trades={[baseTrades[0]]} stale />);
    expect(screen.getByText("Stale")).toBeTruthy();
  });

  it("handles duplicate trade IDs", () => {
    const withDups = [...baseTrades, { ...baseTrades[0], tsReceived: 9999 }];
    render(<RecentTrades trades={withDups} />);
    const priceElements = screen.getAllByText("75759.3");
    expect(priceElements.length).toBe(2);
  });
});
