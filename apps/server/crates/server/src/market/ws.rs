use crate::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::atomic::{AtomicI64, Ordering};
use tokio::sync::mpsc;
use tower_sessions::Session;

#[derive(Deserialize)]
struct ClientMsg {
    op: String,
    symbol: Option<String>,
}

pub async fn ws_market(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    session: Session,
    State(state): State<AppState>,
) -> impl IntoResponse {
    // auth
    let user: Option<uuid::Uuid> = session.get("user_id").await.unwrap_or(None);
    if user.is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    // origin check
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    if let Some(cfg_origin) = &state.config.cors_origin {
        if origin != Some(cfg_origin.as_str()) {
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::channel::<Message>(64);
    // sender task
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let engine = state.market_engine.clone();
    let mut broadcast_rx = engine.subscribe();
    let mut broadcast_ob_rx = engine.subscribe_orderbook();
    let last_sent = std::sync::Arc::new(AtomicI64::new(0));
    let last_sent_fwd = last_sent.clone();
    // forward broadcast
    let tx2 = tx.clone();
    let fwd = tokio::spawn(async move {
        loop {
            tokio::select! {
                Ok(ticker) = broadcast_rx.recv() => {
                    let msg = serde_json::json!({
                        "type": "ticker",
                        "data": {
                            "symbol": ticker.symbol,
                            "last": ticker.last.to_string(),
                            "bid": ticker.bid.map(|d| d.to_string()),
                            "ask": ticker.ask.map(|d| d.to_string()),
                            "markPrice": ticker.mark_price.map(|d| d.to_string()),
                            "indexPrice": ticker.index_price.map(|d| d.to_string()),
                            "high24h": ticker.high_24h.map(|d| d.to_string()),
                            "low24h": ticker.low_24h.map(|d| d.to_string()),
                            "change24h": ticker.change_24h.map(|d| d.to_string()),
                            "fundingRate": ticker.funding_rate.map(|d| d.to_string()),
                            "tsExchange": ticker.ts_exchange,
                            "tsReceived": ticker.ts_received,
                        }
                    });
                    last_sent_fwd.store(ticker.ts_received, Ordering::SeqCst);
                    if tx2.send(Message::Text(msg.to_string().into())).await.is_err() { break; }
                }
                Ok(book) = broadcast_ob_rx.recv() => {
                    let msg = serde_json::json!({
                        "type": "orderbook",
                        "data": {
                            "symbol": book.symbol,
                            "bids": book.bids.iter().map(|l| serde_json::json!({"price":l.price.to_string(),"quantity":l.quantity.to_string()})).collect::<Vec<_>>(),
                            "asks": book.asks.iter().map(|l| serde_json::json!({"price":l.price.to_string(),"quantity":l.quantity.to_string()})).collect::<Vec<_>>(),
                            "tsExchange": book.ts_exchange,
                            "tsReceived": book.ts_received,
                            "seq": book.seq,
                            "source": book.source,
                        }
                    });
                    if tx2.send(Message::Text(msg.to_string().into())).await.is_err() { break; }
                }
                else => break,
            }
        }
    });

    // initial snapshot
    if let Some(t) = engine.latest_ticker("BTCUSDT").await {
        if t.ts_received > last_sent.load(Ordering::SeqCst) {
            let msg = serde_json::json!({"type":"snapshot","data":{"symbol":t.symbol,"last":t.last.to_string(),"bid":t.bid.map(|d|d.to_string()),"ask":t.ask.map(|d|d.to_string()),"markPrice":t.mark_price.map(|d|d.to_string()),"indexPrice":t.index_price.map(|d|d.to_string()),"high24h":t.high_24h.map(|d|d.to_string()),"low24h":t.low_24h.map(|d|d.to_string()),"change24h":t.change_24h.map(|d|d.to_string()),"fundingRate":t.funding_rate.map(|d|d.to_string()),"tsExchange":t.ts_exchange,"tsReceived":t.ts_received}});
            let _ = tx.send(Message::Text(msg.to_string().into())).await;
            last_sent.store(t.ts_received, Ordering::SeqCst);
        }
    }
    // initial order book snapshot
    if let Some(b) = engine.latest_orderbook("BTCUSDT").await {
        let msg = serde_json::json!({"type":"orderbook","data":{"symbol":b.symbol,"bids":b.bids.iter().map(|l| serde_json::json!({"price":l.price.to_string(),"quantity":l.quantity.to_string()})).collect::<Vec<_>>(),"asks":b.asks.iter().map(|l| serde_json::json!({"price":l.price.to_string(),"quantity":l.quantity.to_string()})).collect::<Vec<_>>(),"tsExchange":b.ts_exchange,"tsReceived":b.ts_received,"seq":b.seq,"source":b.source}});
        let _ = tx.send(Message::Text(msg.to_string().into())).await;
    }
    while let Some(Ok(msg)) = stream.next().await {
        if let Message::Text(text) = msg {
            if let Ok(cm) = serde_json::from_str::<ClientMsg>(&text) {
                if cm.op == "subscribe" {
                    let symbol = cm.symbol.clone().unwrap_or_else(|| "BTCUSDT".to_string());
                    if let Some(t) = engine.latest_ticker(&symbol).await {
                        let msg = serde_json::json!({"type":"snapshot","data":{"symbol":t.symbol,"last":t.last.to_string()}});
                        let _ = tx.send(Message::Text(msg.to_string().into())).await;
                    }
                    let ack = serde_json::json!({"type":"subscribed","data":{"symbol":symbol}});
                    let _ = tx.send(Message::Text(ack.to_string().into())).await;
                }
            }
        }
    }

    fwd.abort();
    send_task.abort();
}
