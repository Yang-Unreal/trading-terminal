import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, useEffect, useCallback } from "react";
import { useTicker, useMarketStore, useOrderBook, useTrades, useCandles, subscribeMarket, fetchPreferences, savePreferences, type ChartGranularity } from "@/lib/market";
import { OrderBook } from "@/components/order-book";
import { RecentTrades } from "@/components/recent-trades";
import { CandlestickChart, CandlestickControls, type CandlestickChartHandle } from "@/components/candlestick-chart";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/markets/$symbol")({
  component: MarketPage,
});

function MarketPage() {
  const { symbol } = Route.useParams();
  const { loading: authLoading, authenticated } = useAuth();
  const navigate = useNavigate();
  const ticker = useTicker(symbol);
  const orderBook = useOrderBook(symbol);
  const trades = useTrades(symbol);
  const store = useMarketStore();
  const chartRef = useRef<CandlestickChartHandle | null>(null);

  const [prefLoading, setPrefLoading] = useState(true);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [granularity, setGranularityState] = useState<ChartGranularity>("1m");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveGenRef = useRef(0);

  const candles = useCandles(symbol, granularity);

  useEffect(() => {
    if (!authLoading && !authenticated) {
      navigate({ to: "/login" });
    }
  }, [authLoading, authenticated, navigate]);

  useEffect(() => {
    if (authenticated) {
      subscribeMarket(symbol);
    }
  }, [symbol, authenticated]);

  // Load saved preference once authenticated
  useEffect(() => {
    let cancelled = false;
    async function loadPrefs() {
      if (!authenticated) return;
      setPrefLoading(true);
      setPrefError(null);
      try {
        const prefs = await fetchPreferences();
        if (!cancelled) {
          setGranularityState(prefs.chart_granularity);
        }
      } catch (e) {
        if (!cancelled) {
          setPrefError(e instanceof Error ? e.message : "Failed to load preferences");
          setGranularityState("1m");
        }
      } finally {
        if (!cancelled) setPrefLoading(false);
      }
    }
    loadPrefs();
    return () => { cancelled = true; };
  }, [authenticated]);

  const handleGranularityChange = useCallback((next: ChartGranularity) => {
    setGranularityState(next);
    setSaveError(null);
    const gen = ++saveGenRef.current;
    savePreferences(next).then(() => {
      if (gen === saveGenRef.current) {
        // latest save completed
      }
    }).catch((e) => {
      if (gen === saveGenRef.current) {
        setSaveError(e instanceof Error ? e.message : "Failed to save preference");
      }
    });
  }, []);

  const handleAuto = () => {
    chartRef.current?.autoScale();
  };

  const handleFitAll = () => {
    chartRef.current?.fitContent();
  };

  if (authLoading) return <div className="p-4">Loading...</div>;
  if (!authenticated) return null;
  if (prefLoading) return <div className="p-4">Loading chart preferences...</div>;

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

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <CandlestickControls
            granularity={granularity}
            onGranularityChange={handleGranularityChange}
            onAuto={handleAuto}
            onFitAll={handleFitAll}
            loadingOlder={false}
            saveError={saveError}
          />
          <CandlestickChart ref={chartRef} symbol={symbol} granularity={granularity} />
        </div>
        <div className="w-full lg:w-80 flex flex-col gap-4">
          <OrderBook orderBook={orderBook} stale={store.orderBookStale} />
          <RecentTrades trades={trades} stale={store.tradesStale} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Last Price" value={ticker?.last ?? "--"} />
        <Stat label="24h Change" value={ticker?.change24h ?? "--"} />
        <Stat label="Bid" value={ticker?.bid ?? "--"} />
        <Stat label="Ask" value={ticker?.ask ?? "--"} />
        <Stat label="Mark Price" value={ticker?.markPrice ?? "--"} />
        <Stat label="Index Price" value={ticker?.indexPrice ?? "--"} />
        <Stat label="24h High" value={ticker?.high24h ?? "--"} />
        <Stat label="24h Low" value={ticker?.low24h ?? "--"} />
        <Stat label="Funding Rate" value={ticker?.fundingRate ?? "--"} />
        <Stat label="Candles" value={String(candles.length)} />
        <Stat label="Last Update" value={store.lastUpdate ? new Date(store.lastUpdate).toLocaleTimeString() : "--"} />
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
