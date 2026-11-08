import { useMemo } from "react";
import { formatDecimal, multiplyDecimal } from "@/lib/decimal";

interface Trade {
  tradeId: string;
  symbol: string;
  price: string;
  size: string;
  side: "buy" | "sell";
  tsExchange?: number | null;
  tsReceived?: number | null;
  source?: string | null;
}

interface RecentTradesProps {
  trades: Trade[];
  stale?: boolean;
}

export function RecentTrades({ trades, stale }: RecentTradesProps) {
  const sorted = useMemo(
    () => [...trades]
      .sort((a, b) => {
        const ta = a.tsReceived ?? 0;
        const tb = b.tsReceived ?? 0;
        return tb - ta;
      })
      .slice(0, 100),
    [trades]
  );

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Recent Trades</h2>
        {stale && <span className="text-xs text-yellow-500">Stale</span>}
      </div>
      <div className="grid grid-cols-5 text-xs text-muted-foreground font-mono">
        <span>Time</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Notional</span>
        <span className="text-right">Side</span>
      </div>
      <div className="space-y-0.5 max-h-64 overflow-y-auto">
        {sorted.map((trade) => {
          const notional = multiplyDecimal(trade.price, trade.size);
          const time = trade.tsReceived
            ? new Date(trade.tsReceived).toLocaleTimeString("en-US", {
                hour12: false,
                minute: "2-digit",
                second: "2-digit",
              })
            : "--";
          const sideColor = trade.side === "buy" ? "text-green-500" : "text-red-500";
          return (
            <div
              key={trade.tradeId}
              className="grid grid-cols-5 text-xs font-mono"
            >
              <span>{time}</span>
              <span className="text-right">{formatDecimal(trade.price)}</span>
              <span className="text-right">{formatDecimal(trade.size)}</span>
              <span className="text-right text-muted-foreground">{formatDecimal(notional)}</span>
              <span className={`text-right font-medium ${sideColor}`}>
                {trade.side === "buy" ? "Buy" : "Sell"}
              </span>
            </div>
          );
        })}
      </div>
      {sorted.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-2">No trades</div>
      )}
    </div>
  );
}
