import { createFileRoute } from "@tanstack/react-router";
import { useTicker, useMarketStore, useOrderBook, subscribeMarket } from "@/lib/market";
import { OrderBook } from "@/components/order-book";
import { useEffect } from "react";

export const Route = createFileRoute("/markets/$symbol")({
  component: MarketPage,
});

function MarketPage() {
  const { symbol } = Route.useParams();
  const ticker = useTicker(symbol);
  const orderBook = useOrderBook(symbol);
  const store = useMarketStore();

  useEffect(() => {
    subscribeMarket(symbol);
  }, [symbol]);

  const statusColor =
    store.status === "connected" ? "text-green-500" : store.status === "reconnecting" ? "text-yellow-500" : "text-red-500";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{symbol}</h1>
          <p className="text-sm text-muted-foreground">USDT-FUTURES</p>
        </div>
        <div className={`text-sm font-medium ${statusColor}`}>
          {store.status}{store.stale ? " (stale)" : ""}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Last Price" value={ticker?.last ?? "--"} />
        <Stat label="24h Change" value={ticker?.change24h ?? "--"} />
        <Stat label="Bid" value={ticker?.bid ?? "--"} />
        <Stat label="Ask" value={ticker?.ask ?? "--"} />
        <Stat label="Mark Price" value={ticker?.markPrice ?? "--"} />
        <Stat label="Index Price" value={ticker?.indexPrice ?? "--"} />
        <Stat label="24h High" value={ticker?.high24h ?? "--"} />
        <Stat label="24h Low" value={ticker?.low24h ?? "--"} />
        <Stat label="Funding Rate" value={ticker?.fundingRate ?? "--"} />
        <Stat label="Last Update" value={store.lastUpdate ? new Date(store.lastUpdate).toLocaleTimeString() : "--"} />
        </div>
        <OrderBook orderBook={orderBook} stale={store.orderBookStale} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-mono">{value}</div>
    </div>
  );
}
