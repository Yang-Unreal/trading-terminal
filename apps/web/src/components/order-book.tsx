import { useMemo } from "react";
import { addDecimal, divideDecimal, formatDecimal, multiplyDecimal, subtractDecimal } from "@/lib/decimal";

interface Level { price: string; quantity: string; }

interface OrderBookProps {
  orderBook?: { bids: Level[]; asks: Level[] } | null;
  stale?: boolean;
}

export function OrderBook({ orderBook, stale }: OrderBookProps) {
  const asksHighToLow = useMemo(() => [...(orderBook?.asks ?? [])].sort((a, b) => Number(b.price) - Number(a.price)), []);
  const bidsHighToLow = useMemo(() => [...(orderBook?.bids ?? [])].sort((a, b) => Number(b.price) - Number(a.price)), []);

  const askCumulative = useMemo(() => {
    const ascending = [...(orderBook?.asks ?? [])].sort((a, b) => Number(a.price) - Number(b.price));
    const result: string[] = [];
    let total = "0";
    for (const level of ascending) {
      total = addDecimal(total, level.quantity);
      result.push(total);
    }
    return result.reverse();
  }, [orderBook]);

  const bidCumulative = useMemo(() => {
    const result: string[] = [];
    let total = "0";
    for (const level of bidsHighToLow) {
      total = addDecimal(total, level.quantity);
      result.push(total);
    }
    return result;
  }, [bidsHighToLow]);

  const maxAskCumulative = askCumulative.length ? askCumulative[0] : "1";
  const maxBidCumulative = bidCumulative.length ? bidCumulative[bidCumulative.length - 1] : "1";

  const bestBid = bidsHighToLow[0]?.price ?? null;
  const bestAsk = asksHighToLow.length ? asksHighToLow[asksHighToLow.length - 1]?.price ?? null : null;
  const spread = bestBid && bestAsk ? subtractDecimal(bestAsk, bestBid) : null;
  const mid = bestBid && bestAsk ? divideDecimal(addDecimal(bestBid, bestAsk), "2") : null;
  const spreadPercent = spread && mid ? multiplyDecimal(divideDecimal(spread, mid), "100") : null;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Order Book</h2>
        {stale && <span className="text-xs text-yellow-500">Stale</span>}
      </div>
      <div className="grid grid-cols-3 text-xs text-muted-foreground font-mono">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      <div className="space-y-0.5">
        {asksHighToLow.map((level, i) => (
          <div key={`ask-${level.price}`} className="relative grid grid-cols-3 text-xs font-mono">
            <div className="absolute inset-y-0 right-0 bg-red-500/10" style={{ width: `${(Number(askCumulative[i]) / Number(maxAskCumulative)) * 100}%` }} />
            <span className="text-red-500">{formatDecimal(level.price)}</span>
            <span className="text-right">{formatDecimal(level.quantity)}</span>
            <span className="text-right text-muted-foreground">{formatDecimal(askCumulative[i])}</span>
          </div>
        ))}
      </div>
      <div className="border-y py-1 text-xs font-mono">
        <div>Spread: {spread ? formatDecimal(spread) : "--"} {spreadPercent ? `(${formatDecimal(spreadPercent, 4)}%)` : ""}</div>
        <div>Mid: {mid ? formatDecimal(mid) : "--"}</div>
      </div>
      <div className="space-y-0.5">
        {bidsHighToLow.map((level, i) => (
          <div key={`bid-${level.price}`} className="relative grid grid-cols-3 text-xs font-mono">
            <div className="absolute inset-y-0 right-0 bg-green-500/10" style={{ width: `${(Number(bidCumulative[i]) / Number(maxBidCumulative)) * 100}%` }} />
            <span className="text-green-500">{formatDecimal(level.price)}</span>
            <span className="text-right">{formatDecimal(level.quantity)}</span>
            <span className="text-right text-muted-foreground">{formatDecimal(bidCumulative[i])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}