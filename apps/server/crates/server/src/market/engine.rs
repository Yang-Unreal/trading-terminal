use crate::market::bitget::ws::{
    parse_candle_message, parse_order_book_message, parse_ticker_message, parse_trade_message,
};
use crate::market::models::{Candle, OrderBook, Ticker, Trade};
use futures_util::sink::SinkExt;
use futures_util::stream::StreamExt;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tokio::time::{interval, Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

const TRADE_BUFFER_CAP: usize = 100;
const CANDLE_BUFFER_CAP: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionStatus {
    Connecting,
    Connected,
    Reconnecting,
    Disconnected,
}

pub struct MarketDataEngine {
    symbols: Vec<String>,
    ws_url: String,
    ws_proxy: Option<String>,
    tx: broadcast::Sender<Ticker>,
    tx_orderbook: broadcast::Sender<OrderBook>,
    tx_trades: broadcast::Sender<Trade>,
    tx_candles: broadcast::Sender<Candle>,
    latest: Arc<RwLock<HashMap<String, Ticker>>>,
    latest_orderbook: Arc<RwLock<HashMap<String, OrderBook>>>,
    latest_trades: Arc<RwLock<VecDeque<Trade>>>,
    latest_candles: Arc<RwLock<HashMap<String, HashMap<String, VecDeque<Candle>>>>>,
    seen_trade_ids: Arc<RwLock<HashSet<String>>>,
    status: Arc<RwLock<ConnectionStatus>>,
    last_ticker: Arc<RwLock<Option<Instant>>>,
    last_orderbook: Arc<RwLock<Option<Instant>>>,
    last_trade: Arc<RwLock<Option<Instant>>>,
    orderbook_live: Arc<RwLock<HashMap<String, bool>>>,
    trades_live: Arc<RwLock<HashMap<String, bool>>>,
    candles_live: Arc<RwLock<HashMap<String, HashMap<String, bool>>>>,
}

impl MarketDataEngine {
    pub fn new(symbols: Vec<String>) -> Self {
        Self::new_with_url(symbols, "wss://ws.bitget.com/v2/ws/public".to_string())
    }

    pub fn new_with_url(symbols: Vec<String>, ws_url: String) -> Self {
        Self::new_with_url_and_proxy(symbols, ws_url, None)
    }

    pub fn new_with_url_and_proxy(
        symbols: Vec<String>,
        ws_url: String,
        ws_proxy: Option<String>,
    ) -> Self {
        let (tx, _) = broadcast::channel(256);
        let (tx_orderbook, _) = broadcast::channel(256);
        let (tx_trades, _) = broadcast::channel(256);
        let (tx_candles, _) = broadcast::channel(256);
        Self {
            symbols,
            ws_url,
            ws_proxy,
            tx,
            tx_orderbook,
            tx_trades,
            tx_candles,
            latest: Arc::new(RwLock::new(HashMap::new())),
            latest_orderbook: Arc::new(RwLock::new(HashMap::new())),
            latest_trades: Arc::new(RwLock::new(VecDeque::with_capacity(TRADE_BUFFER_CAP))),
            latest_candles: Arc::new(RwLock::new(HashMap::new())),
            seen_trade_ids: Arc::new(RwLock::new(HashSet::new())),
            status: Arc::new(RwLock::new(ConnectionStatus::Disconnected)),
            last_ticker: Arc::new(RwLock::new(None)),
            last_orderbook: Arc::new(RwLock::new(None)),
            last_trade: Arc::new(RwLock::new(None)),
            orderbook_live: Arc::new(RwLock::new(HashMap::new())),
            trades_live: Arc::new(RwLock::new(HashMap::new())),
            candles_live: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Ticker> {
        self.tx.subscribe()
    }

    pub async fn latest_ticker(&self, symbol: &str) -> Option<Ticker> {
        self.latest.read().await.get(symbol).cloned()
    }

    pub fn subscribe_orderbook(&self) -> broadcast::Receiver<OrderBook> {
        self.tx_orderbook.subscribe()
    }

    pub async fn latest_orderbook(&self, symbol: &str) -> Option<OrderBook> {
        self.latest_orderbook.read().await.get(symbol).cloned()
    }

    pub async fn orderbook_is_live(&self, symbol: &str) -> bool {
        self.orderbook_live
            .read()
            .await
            .get(symbol)
            .copied()
            .unwrap_or(false)
    }

    pub async fn update_orderbook_from_rest(&self, book: OrderBook) -> bool {
        let symbol = book.symbol.clone();
        let mut latest = self.latest_orderbook.write().await;
        if let Some(old) = latest.get(&symbol) {
            if old.source == "websocket" {
                return false;
            }
            if let (Some(old_seq), Some(new_seq)) = (&old.seq, &book.seq) {
                if !seq_greater(new_seq, old_seq) {
                    return false;
                }
            }
        }
        latest.insert(symbol.clone(), book);
        drop(latest);
        let mut live = self.orderbook_live.write().await;
        live.insert(symbol, false);
        true
    }

    pub async fn mark_orderbook_stale(&self, symbol: &str) {
        let mut live = self.orderbook_live.write().await;
        live.insert(symbol.to_string(), false);
    }

    pub fn subscribe_trades(&self) -> broadcast::Receiver<Trade> {
        self.tx_trades.subscribe()
    }

    pub async fn latest_trades(&self, symbol: &str) -> Vec<Trade> {
        self.latest_trades
            .read()
            .await
            .iter()
            .filter(|t| t.symbol == symbol)
            .cloned()
            .collect()
    }

    pub async fn trades_is_live(&self, symbol: &str) -> bool {
        self.trades_live
            .read()
            .await
            .get(symbol)
            .copied()
            .unwrap_or(false)
    }

    pub async fn mark_trades_stale(&self, symbol: &str) {
        let mut live = self.trades_live.write().await;
        live.insert(symbol.to_string(), false);
    }

    pub fn subscribe_candles(&self) -> broadcast::Receiver<Candle> {
        self.tx_candles.subscribe()
    }

    pub async fn latest_candles(&self, symbol: &str, granularity: &str) -> Vec<Candle> {
        self.latest_candles
            .read()
            .await
            .get(symbol)
            .and_then(|m| m.get(granularity))
            .cloned()
            .unwrap_or_default()
            .into()
    }

    pub async fn candles_is_live(&self, symbol: &str, granularity: &str) -> bool {
        self.candles_live
            .read()
            .await
            .get(symbol)
            .and_then(|m| m.get(granularity))
            .copied()
            .unwrap_or(false)
    }

    pub async fn mark_candles_stale(&self, symbol: &str, granularity: &str) {
        let mut live = self.candles_live.write().await;
        live.entry(symbol.to_string())
            .or_default()
            .insert(granularity.to_string(), false);
    }

    pub async fn update_candles_from_rest(
        &self,
        symbol: &str,
        granularity: &str,
        candles: Vec<Candle>,
    ) -> bool {
        if candles.is_empty() {
            return false;
        }
        {
            let mut buffer_map = self.latest_candles.write().await;
            let granularity_map = buffer_map.entry(symbol.to_string()).or_default();
            let buffer = granularity_map
                .entry(granularity.to_string())
                .or_insert_with(|| VecDeque::with_capacity(CANDLE_BUFFER_CAP));
            for candle in candles {
                let start_time = candle.start_time;
                let existing_idx = buffer.iter().position(|c| c.start_time == start_time);
                match existing_idx {
                    Some(idx) => {
                        buffer[idx] = candle;
                    }
                    None => {
                        if buffer.len() >= CANDLE_BUFFER_CAP {
                            buffer.pop_front();
                        }
                        buffer.push_back(candle);
                    }
                }
            }
            let mut sorted: Vec<Candle> = buffer.iter().cloned().collect();
            sorted.sort_by(|a, b| a.start_time.cmp(&b.start_time));
            *buffer = VecDeque::from(sorted);
        }
        let mut live = self.candles_live.write().await;
        live.entry(symbol.to_string())
            .or_default()
            .insert(granularity.to_string(), false);
        true
    }

    pub async fn update_trades_from_rest(&self, trades: Vec<Trade>) -> bool {
        if trades.is_empty() {
            return false;
        }
        let symbol = trades[0].symbol.clone();
        let mut buffer = self.latest_trades.write().await;
        let mut seen = self.seen_trade_ids.write().await;
        for trade in trades {
            if seen.insert(trade.trade_id.clone()) {
                if buffer.len() >= TRADE_BUFFER_CAP {
                    buffer.pop_front();
                }
                buffer.push_back(trade);
            }
        }
        drop(seen);
        drop(buffer);
        let mut live = self.trades_live.write().await;
        live.insert(symbol, false);
        true
    }

    pub async fn connection_status(&self) -> ConnectionStatus {
        *self.status.read().await
    }

    pub fn start(self: Arc<Self>) {
        let engine = self.clone();
        tokio::spawn(async move {
            let mut backoff = Duration::from_secs(1);
            loop {
                *engine.status.write().await = ConnectionStatus::Connecting;
                let ws = if let Some(proxy) = &self.ws_proxy {
                    connect_via_socks5(&self.ws_url, proxy).await
                } else {
                    connect_direct(&self.ws_url).await
                };
                let mut ws = match ws {
                    Ok(v) => v,
                    Err(_e) => {
                        *engine.status.write().await = ConnectionStatus::Reconnecting;
                        tokio::time::sleep(backoff).await;
                        backoff = (backoff * 2).min(Duration::from_secs(30));
                        continue;
                    }
                };

                let sub = serde_json::json!({
                    "op": "subscribe",
                    "args": engine.symbols.iter().flat_map(|s| vec![
                        serde_json::json!({"instType":"USDT-FUTURES","channel":"ticker","instId":s}),
                        serde_json::json!({"instType":"USDT-FUTURES","channel":"books15","instId":s}),
                        serde_json::json!({"instType":"USDT-FUTURES","channel":"trade","instId":s}),
                        serde_json::json!({"instType":"USDT-FUTURES","channel":"candle1m","instId":s}),
                        serde_json::json!({"instType":"USDT-FUTURES","channel":"candle5m","instId":s}),
                        serde_json::json!({"instType":"USDT-FUTURES","channel":"candle15m","instId":s}),
                        serde_json::json!({"instType":"USDT-FUTURES","channel":"candle1H","instId":s}),
                        serde_json::json!({"instType":"USDT-FUTURES","channel":"candle4H","instId":s}),
                        serde_json::json!({"instType":"USDT-FUTURES","channel":"candle1Dutc","instId":s}),
                    ]).collect::<Vec<_>>()
                });
                if ws.send(Message::Text(sub.to_string())).await.is_err() {
                    *engine.status.write().await = ConnectionStatus::Reconnecting;
                    let _ = ws.close(None).await;
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(Duration::from_secs(30));
                    continue;
                }

                *engine.status.write().await = ConnectionStatus::Connected;
                backoff = Duration::from_secs(1);

                let mut hb = interval(Duration::from_secs(30));
                hb.tick().await;
                let mut last_pong = Instant::now();

                loop {
                    tokio::select! {
                        msg = ws.next() => {
                            match msg {
                                Some(Ok(Message::Text(t))) => {
                                    if t == "pong" {
                                        last_pong = Instant::now();
                                        continue;
                                    }
                                    match parse_ticker_message(&t) {
                                        Ok(Some(tick)) => {
                                            let mut latest = engine.latest.write().await;
                                            let replace = latest.get(&tick.symbol).map(|old| tick.ts_exchange.unwrap_or(0) >= old.ts_exchange.unwrap_or(0)).unwrap_or(true);
                                            if replace {
                                                latest.insert(tick.symbol.clone(), tick.clone());
                                            }
                                            drop(latest);
                                            let _ = engine.tx.send(tick);
                                            *engine.last_ticker.write().await = Some(Instant::now());
                                        }
                                        _ => {
                                            let mut handled = false;
                                            if let Ok(Some(book)) = parse_order_book_message(&t) {
                                                let symbol = book.symbol.clone();
                                                let mut latest = engine.latest_orderbook.write().await;
                                                let replace = match latest.get(&symbol) {
                                                    Some(old) => {
                                                        if old.source == "websocket" {
                                                            seq_greater(
                                                                book.seq.as_deref().unwrap_or(""),
                                                                old.seq.as_deref().unwrap_or(""),
                                                            ) || old.seq.is_none()
                                                        } else {
                                                            true
                                                        }
                                                    }
                                                    None => true,
                                                };
                                                if replace {
                                                    latest.insert(symbol.clone(), book.clone());
                                                    drop(latest);
                                                    let mut live = engine.orderbook_live.write().await;
                                                    live.insert(symbol.clone(), true);
                                                    drop(live);
                                                    *engine.last_orderbook.write().await = Some(Instant::now());
                                                    let _ = engine.tx_orderbook.send(book);
                                                    handled = true;
                                                } else {
                                                    drop(latest);
                                                }
                                            }
                                            if !handled {
                                                if let Ok(Some(trades)) = parse_trade_message(&t) {
                                                    let mut buffer = engine.latest_trades.write().await;
                                                    let mut seen = engine.seen_trade_ids.write().await;
                                                    for trade in &trades {
                                                        if seen.insert(trade.trade_id.clone()) {
                                                            if buffer.len() >= TRADE_BUFFER_CAP {
                                                                buffer.pop_front();
                                                            }
                                                            buffer.push_back(trade.clone());
                                                        }
                                                    }
                                                    drop(seen);
                                                    drop(buffer);
                                                    let mut live = engine.trades_live.write().await;
                                                    if let Some(t) = trades.first() {
                                                        live.insert(t.symbol.clone(), true);
                                                    }
                                                    drop(live);
                                                    *engine.last_trade.write().await = Some(Instant::now());
                                                    for trade in trades {
                                                        let _ = engine.tx_trades.send(trade);
                                                    }
                                                }
                                            }
                                            if !handled {
                                                if let Ok(Some(candles)) = parse_candle_message(&t) {
                                                    for candle in &candles {
                                                        let symbol = candle.symbol.clone();
                                                        let granularity = candle.granularity.clone();
                                                        let start_time = candle.start_time;
                                                        {
                                                            let mut buffer_map = engine.latest_candles.write().await;
                                                            let granularity_map = buffer_map.entry(symbol.clone()).or_default();
                                                            let buffer = granularity_map.entry(granularity.clone()).or_insert_with(|| VecDeque::with_capacity(CANDLE_BUFFER_CAP));
                                                            let existing_idx = buffer.iter().position(|c| c.start_time == start_time);
                                                            match existing_idx {
                                                                Some(idx) => {
                                                                    buffer[idx] = candle.clone();
                                                                }
                                                                None => {
                                                                    if buffer.len() >= CANDLE_BUFFER_CAP {
                                                                        buffer.pop_front();
                                                                    }
                                                                    buffer.push_back(candle.clone());
                                                                }
                                                            }
                                                        }
                                                        let mut live = engine.candles_live.write().await;
                                                        live.entry(symbol).or_default().insert(granularity, true);
                                                        drop(live);
                                                    }
                                                    for candle in candles {
                                                        let _ = engine.tx_candles.send(candle);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Some(Ok(Message::Ping(p))) => {
                                    let _ = ws.send(Message::Pong(p)).await;
                                }
                                Some(Ok(Message::Pong(_))) => {
                                    last_pong = Instant::now();
                                }
                                Some(Ok(Message::Close(_))) | None => break,
                                Some(Err(_)) => break,
                                _ => {}
                            }
                        }
                        _ = hb.tick() => {
                            if ws.send(Message::Text("ping".to_string())).await.is_err() {
                                break;
                            }
                            if last_pong.elapsed() > Duration::from_secs(35) {
                                break;
                            }
                        }
                    }
                }

                *engine.status.write().await = ConnectionStatus::Reconnecting;
                let _ = ws.close(None).await;
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
            }
        });
    }
}

fn seq_greater(new: &str, old: &str) -> bool {
    match (new.parse::<i128>(), old.parse::<i128>()) {
        (Ok(n), Ok(o)) => n > o,
        _ => new != old,
    }
}
#[tokio::test]
async fn reconnection_restores_ticker() {
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("ws://{}", addr);
    let server = tokio::spawn(async move {
        // first connection
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        let _ = ws.next().await;
        ws.send(Message::Text(r#"{"event":"subscribe","arg":{"instType":"USDT-FUTURES","channel":"ticker","instId":"BTCUSDT"}}"#.to_string())).await.unwrap();
        ws.send(Message::Text(
            r#"{"action":"snapshot","data":[{"symbol":"BTCUSDT","lastPr":"100","ts":"1"}]}"#
                .to_string(),
        ))
        .await
        .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let _ = ws.close(None).await;
        // second connection
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        let _ = ws.next().await;
        ws.send(Message::Text(r#"{"event":"subscribe","arg":{"instType":"USDT-FUTURES","channel":"ticker","instId":"BTCUSDT"}}"#.to_string())).await.unwrap();
        ws.send(Message::Text(
            r#"{"action":"snapshot","data":[{"symbol":"BTCUSDT","lastPr":"200","ts":"2"}]}"#
                .to_string(),
        ))
        .await
        .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    });

    let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
        vec!["BTCUSDT".to_string()],
        url,
    ));
    let mut rx = engine.subscribe();
    engine.clone().start();
    // wait first
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if engine
                .latest_ticker("BTCUSDT")
                .await
                .map(|t| t.last.to_string())
                == Some("100".to_string())
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await;
    // wait second
    let _ = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            if engine
                .latest_ticker("BTCUSDT")
                .await
                .map(|t| t.last.to_string())
                == Some("200".to_string())
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await;
    let t = engine.latest_ticker("BTCUSDT").await.unwrap();
    assert_eq!(t.last.to_string(), "200");
    // ensure broadcast received second
    let mut got = false;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while let Ok(msg) = rx.recv().await {
            if msg.last.to_string() == "200" {
                got = true;
                break;
            }
        }
    })
    .await;
    assert!(got);
    let _ = server.await;
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::market::models::TradeSide;
    use futures_util::sink::SinkExt;
    use futures_util::stream::StreamExt;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;
    use tokio_tungstenite::tungstenite::Message;

    #[tokio::test]
    async fn mock_connects_and_receives_ticker() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("ws://{}", addr);
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            let msg = ws.next().await.unwrap().unwrap();
            if let Message::Text(t) = msg {
                assert!(t.contains("USDT-FUTURES"));
                assert!(t.contains("ticker"));
                assert!(t.contains("BTCUSDT"));
            }
            ws.send(Message::Text(r#"{"event":"subscribe","arg":{"instType":"USDT-FUTURES","channel":"ticker","instId":"BTCUSDT"}}"#.to_string())).await.unwrap();
            ws.send(Message::Text(r#"{"action":"snapshot","data":[{"symbol":"BTCUSDT","lastPr":"100.5","bidPr":"100.4","askPr":"100.6","fundingRate":"0.0001","ts":"123"}]}"#.to_string())).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        });

        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            url,
        ));
        engine.clone().start();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if engine.latest_ticker("BTCUSDT").await.is_some() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        })
        .await
        .unwrap();
        let t = engine.latest_ticker("BTCUSDT").await.unwrap();
        assert_eq!(t.symbol, "BTCUSDT");
        assert_eq!(t.last.to_string(), "100.5");
        assert_eq!(t.bid.unwrap().to_string(), "100.4");
        assert_eq!(t.ask.unwrap().to_string(), "100.6");
        assert_eq!(t.funding_rate.unwrap().to_string(), "0.0001");
        assert_eq!(t.ts_exchange, Some(123));
        let _ = server.await;
    }

    #[tokio::test]
    async fn broadcast_multiple_consumers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("ws://{}", addr);
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            let _ = ws.next().await;
            ws.send(Message::Text(r#"{"event":"subscribe","arg":{"instType":"USDT-FUTURES","channel":"ticker","instId":"BTCUSDT"}}"#.to_string())).await.unwrap();
            ws.send(Message::Text(r#"{"action":"snapshot","data":[{"symbol":"BTCUSDT","lastPr":"101.25","ts":"456"}]}"#.to_string())).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        });
        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            url,
        ));
        let mut r1 = engine.subscribe();
        let mut r2 = engine.subscribe();
        engine.clone().start();
        let mut got1 = false;
        let mut got2 = false;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while !(got1 && got2) {
                tokio::select! {
                    Ok(t) = r1.recv() => { if t.last.to_string()=="101.25" { got1=true; } }
                    Ok(t) = r2.recv() => { if t.last.to_string()=="101.25" { got2=true; } }
                }
            }
        })
        .await;
        assert!(got1 && got2);
        let _ = server.await;
    }

    #[tokio::test]
    async fn subscription_includes_trade_channel() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("ws://{}", addr);
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            let msg = ws.next().await.unwrap().unwrap();
            if let Message::Text(t) = msg {
                assert!(t.contains("USDT-FUTURES"));
                assert!(t.contains("trade"));
                assert!(t.contains("BTCUSDT"));
            }
            let _ = ws.close(None).await;
        });

        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            url,
        ));
        engine.clone().start();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let _ = server.await;
    }

    #[tokio::test]
    async fn trade_message_parsing_and_broadcast() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("ws://{}", addr);
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            let _ = ws.next().await;
            ws.send(Message::Text(r#"{"event":"subscribe","arg":{"instType":"USDT-FUTURES","channel":"trade","instId":"BTCUSDT"}}"#.to_string())).await.unwrap();
            ws.send(Message::Text(r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"trade","instId":"BTCUSDT"},"data":[{"tradeId":"t1","price":"75759.3","size":"0.001","side":"buy","ts":"1794117932000"},{"tradeId":"t2","price":"75760.1","size":"0.5","side":"sell","ts":"1794117933000"}]}"#.to_string())).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        });

        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            url,
        ));
        let mut rx = engine.subscribe_trades();
        engine.clone().start();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if !engine.latest_trades("BTCUSDT").await.is_empty() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        })
        .await
        .unwrap();

        let trades = engine.latest_trades("BTCUSDT").await;
        assert_eq!(trades.len(), 2);
        assert_eq!(trades[0].trade_id, "t1");
        assert_eq!(trades[0].price.to_string(), "75759.3");
        assert_eq!(trades[0].size.to_string(), "0.001");
        assert_eq!(trades[0].side, TradeSide::Buy);
        assert_eq!(trades[1].trade_id, "t2");
        assert_eq!(trades[1].side, TradeSide::Sell);

        let mut got_broadcast = false;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while let Ok(trade) = rx.recv().await {
                if trade.trade_id == "t2" {
                    got_broadcast = true;
                    break;
                }
            }
        })
        .await;
        assert!(got_broadcast);
        let _ = server.await;
    }

    #[tokio::test]
    async fn trade_id_dedup_and_ring_buffer_cap() {
        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            "ws://127.0.0.1:1".to_string(),
        ));

        // Insert 150 trades to test ring buffer cap of 100
        for i in 0..150u64 {
            let trade = Trade {
                trade_id: format!("trade-{}", i),
                symbol: "BTCUSDT".to_string(),
                price: rust_decimal::Decimal::from(i),
                size: rust_decimal::Decimal::ONE,
                side: TradeSide::Buy,
                ts_exchange: Some(i as i64),
                ts_received: i as i64,
                source: "test".to_string(),
            };
            engine.update_trades_from_rest(vec![trade]).await;
        }

        let trades = engine.latest_trades("BTCUSDT").await;
        assert!(trades.len() <= 100);
        // First 50 should have been evicted
        assert!(!trades.iter().any(|t| t.trade_id == "trade-0"));
        // Last one should be present
        assert!(trades.iter().any(|t| t.trade_id == "trade-149"));

        // Dedup: re-insert trade-149, count should not increase
        let before = engine.latest_trades("BTCUSDT").await.len();
        engine
            .update_trades_from_rest(vec![Trade {
                trade_id: "trade-149".to_string(),
                symbol: "BTCUSDT".to_string(),
                price: rust_decimal::Decimal::from(999),
                size: rust_decimal::Decimal::ONE,
                side: TradeSide::Sell,
                ts_exchange: Some(999),
                ts_received: 999,
                source: "test".to_string(),
            }])
            .await;
        let after = engine.latest_trades("BTCUSDT").await.len();
        assert_eq!(before, after);
    }

    #[tokio::test]
    async fn candle_storage_update_and_retrieve() {
        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            "ws://127.0.0.1:1".to_string(),
        ));

        let candle = Candle {
            symbol: "BTCUSDT".to_string(),
            granularity: "1m".to_string(),
            start_time: 1790000000000,
            open: rust_decimal::Decimal::from(100000),
            high: rust_decimal::Decimal::from(100100),
            low: rust_decimal::Decimal::from(99900),
            close: rust_decimal::Decimal::from(100050),
            base_volume: rust_decimal::Decimal::from(125),
            quote_volume: rust_decimal::Decimal::from(12500000),
            usdt_volume: Some(rust_decimal::Decimal::from(12500000)),
            ts_received: 1790000000000,
            source: "test".to_string(),
        };
        engine
            .update_candles_from_rest("BTCUSDT", "1m", vec![candle.clone()])
            .await;

        let stored = engine.latest_candles("BTCUSDT", "1m").await;
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].start_time, 1790000000000);
        assert_eq!(stored[0].close.to_string(), "100050");
    }

    #[tokio::test]
    async fn candle_updates_existing_instead_of_duplicate() {
        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            "ws://127.0.0.1:1".to_string(),
        ));

        let candle1 = Candle {
            symbol: "BTCUSDT".to_string(),
            granularity: "1m".to_string(),
            start_time: 1790000000000,
            open: rust_decimal::Decimal::from(100000),
            high: rust_decimal::Decimal::from(100100),
            low: rust_decimal::Decimal::from(99900),
            close: rust_decimal::Decimal::from(100050),
            base_volume: rust_decimal::Decimal::from(125),
            quote_volume: rust_decimal::Decimal::from(12500000),
            usdt_volume: None,
            ts_received: 1790000000000,
            source: "test".to_string(),
        };
        let candle2 = Candle {
            close: rust_decimal::Decimal::from(100075),
            ..candle1.clone()
        };

        engine
            .update_candles_from_rest("BTCUSDT", "1m", vec![candle1.clone()])
            .await;
        engine
            .update_candles_from_rest("BTCUSDT", "1m", vec![candle2.clone()])
            .await;

        let stored = engine.latest_candles("BTCUSDT", "1m").await;
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].close.to_string(), "100075");
    }

    #[tokio::test]
    async fn candle_appends_new_candle() {
        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            "ws://127.0.0.1:1".to_string(),
        ));

        let make_candle = |start_time: i64, close: u64| Candle {
            symbol: "BTCUSDT".to_string(),
            granularity: "1m".to_string(),
            start_time,
            open: rust_decimal::Decimal::from(close),
            high: rust_decimal::Decimal::from(close + 10),
            low: rust_decimal::Decimal::from(close - 10),
            close: rust_decimal::Decimal::from(close),
            base_volume: rust_decimal::Decimal::from(10),
            quote_volume: rust_decimal::Decimal::from(1000),
            usdt_volume: None,
            ts_received: start_time,
            source: "test".to_string(),
        };

        engine
            .update_candles_from_rest("BTCUSDT", "1m", vec![make_candle(100, 1000)])
            .await;
        engine
            .update_candles_from_rest("BTCUSDT", "1m", vec![make_candle(200, 2000)])
            .await;

        let stored = engine.latest_candles("BTCUSDT", "1m").await;
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].start_time, 100);
        assert_eq!(stored[1].start_time, 200);
    }

    #[tokio::test]
    async fn candle_chronological_ordering() {
        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            "ws://127.0.0.1:1".to_string(),
        ));

        let make_candle = |start_time: i64| Candle {
            symbol: "BTCUSDT".to_string(),
            granularity: "1m".to_string(),
            start_time,
            open: rust_decimal::Decimal::from(100),
            high: rust_decimal::Decimal::from(110),
            low: rust_decimal::Decimal::from(90),
            close: rust_decimal::Decimal::from(100),
            base_volume: rust_decimal::Decimal::from(10),
            quote_volume: rust_decimal::Decimal::from(1000),
            usdt_volume: None,
            ts_received: start_time,
            source: "test".to_string(),
        };

        // Insert out of order
        engine
            .update_candles_from_rest("BTCUSDT", "1m", vec![make_candle(300)])
            .await;
        engine
            .update_candles_from_rest("BTCUSDT", "1m", vec![make_candle(100)])
            .await;
        engine
            .update_candles_from_rest("BTCUSDT", "1m", vec![make_candle(200)])
            .await;

        let stored = engine.latest_candles("BTCUSDT", "1m").await;
        assert_eq!(stored.len(), 3);
        assert_eq!(stored[0].start_time, 100);
        assert_eq!(stored[1].start_time, 200);
        assert_eq!(stored[2].start_time, 300);
    }

    #[tokio::test]
    async fn candle_buffer_cap_500() {
        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            "ws://127.0.0.1:1".to_string(),
        ));

        let make_candle = |start_time: i64| Candle {
            symbol: "BTCUSDT".to_string(),
            granularity: "1m".to_string(),
            start_time,
            open: rust_decimal::Decimal::from(100),
            high: rust_decimal::Decimal::from(110),
            low: rust_decimal::Decimal::from(90),
            close: rust_decimal::Decimal::from(100),
            base_volume: rust_decimal::Decimal::from(10),
            quote_volume: rust_decimal::Decimal::from(1000),
            usdt_volume: None,
            ts_received: start_time,
            source: "test".to_string(),
        };

        for i in 0..600i64 {
            engine
                .update_candles_from_rest("BTCUSDT", "1m", vec![make_candle(i * 60000)])
                .await;
        }

        let stored = engine.latest_candles("BTCUSDT", "1m").await;
        assert_eq!(stored.len(), 500);
        // First 100 should be evicted
        assert!(!stored.iter().any(|c| c.start_time == 0));
        // Last one should be present
        assert!(stored.iter().any(|c| c.start_time == 599 * 60000));
    }

    #[tokio::test]
    async fn candle_separate_granularity_buffers() {
        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            "ws://127.0.0.1:1".to_string(),
        ));

        let make_candle = |granularity: &str, start_time: i64| Candle {
            symbol: "BTCUSDT".to_string(),
            granularity: granularity.to_string(),
            start_time,
            open: rust_decimal::Decimal::from(100),
            high: rust_decimal::Decimal::from(110),
            low: rust_decimal::Decimal::from(90),
            close: rust_decimal::Decimal::from(100),
            base_volume: rust_decimal::Decimal::from(10),
            quote_volume: rust_decimal::Decimal::from(1000),
            usdt_volume: None,
            ts_received: start_time,
            source: "test".to_string(),
        };

        engine
            .update_candles_from_rest("BTCUSDT", "1m", vec![make_candle("1m", 100)])
            .await;
        engine
            .update_candles_from_rest("BTCUSDT", "5m", vec![make_candle("5m", 200)])
            .await;

        let m1 = engine.latest_candles("BTCUSDT", "1m").await;
        let m5 = engine.latest_candles("BTCUSDT", "5m").await;
        assert_eq!(m1.len(), 1);
        assert_eq!(m1[0].start_time, 100);
        assert_eq!(m5.len(), 1);
        assert_eq!(m5[0].start_time, 200);
    }

    #[tokio::test]
    async fn candle_broadcast() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("ws://{}", addr);
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            let _ = ws.next().await;
            ws.send(Message::Text(r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"candle1m","instId":"BTCUSDT"},"data":[["1790000000000","100000","100100","99900","100050","12.5","1250000","1250000"]]}"#.to_string())).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        });

        let engine = std::sync::Arc::new(MarketDataEngine::new_with_url(
            vec!["BTCUSDT".to_string()],
            url,
        ));
        let mut rx = engine.subscribe_candles();
        engine.clone().start();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if !engine.latest_candles("BTCUSDT", "1m").await.is_empty() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        })
        .await
        .unwrap();

        let mut got = false;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while let Ok(candle) = rx.recv().await {
                if candle.start_time == 1790000000000 {
                    got = true;
                    break;
                }
            }
        })
        .await;
        assert!(got);
        let _ = server.await;
    }
}
use rustls::pki_types::ServerName;
use std::sync::Arc as StdArc;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_rustls::TlsConnector;
use tokio_socks::tcp::Socks5Stream;

trait AsyncReadWrite: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AsyncReadWrite for T {}
type BoxedStream = Box<dyn AsyncReadWrite>;

async fn make_tls_connector() -> TlsConnector {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    TlsConnector::from(StdArc::new(config))
}

fn parse_authority(ws_url: &str) -> (String, u16) {
    let without_scheme = ws_url
        .trim()
        .trim_start_matches("wss://")
        .trim_start_matches("ws://");
    let authority = without_scheme.split('/').next().unwrap_or(without_scheme);
    if let Some((h, p)) = authority.split_once(':') {
        (h.to_string(), p.parse::<u16>().unwrap_or(443))
    } else {
        (authority.to_string(), 443)
    }
}

async fn connect_direct(
    ws_url: &str,
) -> Result<tokio_tungstenite::WebSocketStream<BoxedStream>, tokio_tungstenite::tungstenite::Error>
{
    if ws_url.starts_with("ws://") {
        let (host, port) = parse_authority(ws_url);
        let tcp = tokio::net::TcpStream::connect(format!("{}:{}", host, port))
            .await
            .map_err(tokio_tungstenite::tungstenite::Error::Io)?;
        let (ws, _) = tokio_tungstenite::client_async(ws_url, Box::new(tcp) as BoxedStream).await?;
        return Ok(ws);
    }
    let (host, port) = parse_authority(ws_url);
    let tcp = tokio::net::TcpStream::connect(format!("{}:{}", host, port))
        .await
        .map_err(tokio_tungstenite::tungstenite::Error::Io)?;
    let connector = make_tls_connector().await;
    let server_name = ServerName::try_from(host.clone()).map_err(|_| {
        tokio_tungstenite::tungstenite::Error::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid server name",
        ))
    })?;
    let tls = connector
        .connect(server_name, tcp)
        .await
        .map_err(tokio_tungstenite::tungstenite::Error::Io)?;
    let (ws, _) = tokio_tungstenite::client_async(ws_url, Box::new(tls) as BoxedStream).await?;
    Ok(ws)
}

async fn connect_via_socks5(
    ws_url: &str,
    proxy_url: &str,
) -> Result<tokio_tungstenite::WebSocketStream<BoxedStream>, tokio_tungstenite::tungstenite::Error>
{
    let proxy = proxy_url
        .trim()
        .trim_start_matches("socks5://")
        .trim_start_matches("socks5h://");
    let (proxy_host, proxy_port) = if let Some((h, p)) = proxy.split_once(':') {
        (h.to_string(), p.parse::<u16>().unwrap_or(1080))
    } else {
        (proxy.to_string(), 1080)
    };

    let (target_host, target_port) = parse_authority(ws_url);

    let stream = Socks5Stream::connect(
        (proxy_host.as_str(), proxy_port),
        (target_host.as_str(), target_port),
    )
    .await
    .map_err(|e| tokio_tungstenite::tungstenite::Error::Io(std::io::Error::other(e.to_string())))?;

    let connector = make_tls_connector().await;
    let server_name = ServerName::try_from(target_host.clone()).map_err(|_| {
        tokio_tungstenite::tungstenite::Error::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid server name",
        ))
    })?;
    let tls = connector
        .connect(server_name, stream)
        .await
        .map_err(tokio_tungstenite::tungstenite::Error::Io)?;
    let (ws, _) = tokio_tungstenite::client_async(ws_url, Box::new(tls) as BoxedStream).await?;
    Ok(ws)
}
