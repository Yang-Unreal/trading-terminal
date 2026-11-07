use crate::market::errors::MarketError;
use crate::market::models::{OrderBook, OrderBookLevel, Ticker};

#[derive(Debug, Deserialize)]
pub struct BitgetWsBookData {
    pub asks: Option<Vec<Vec<String>>>,
    pub bids: Option<Vec<Vec<String>>>,
    pub ts: Option<serde_json::Value>,
    pub seq: Option<serde_json::Value>,
}

pub fn parse_order_book_message(text: &str) -> Result<Option<OrderBook>, MarketError> {
    let env: BitgetWsEnvelope =
        serde_json::from_str(text).map_err(|e| MarketError::Decode(e.to_string()))?;
    if let Some(code) = &env.code {
        if code != "0" {
            return Err(MarketError::Exchange(format!(
                "{} {}",
                code,
                env.msg.unwrap_or_default()
            )));
        }
    }
    if env.event.as_deref() == Some("error") {
        return Err(MarketError::Exchange(env.msg.unwrap_or_default()));
    }
    let arg = env.arg.as_ref();
    let channel = arg.and_then(|a| a.channel.as_deref()).unwrap_or("");
    if !channel.starts_with("books") {
        return Ok(None);
    }
    let symbol = arg
        .and_then(|a| a.inst_id.clone())
        .unwrap_or_else(|| "BTCUSDT".to_string());
    let _data = match env.data {
        Some(d) if d.as_array().map(|a| !a.is_empty()).unwrap_or(false) => d,
        _ => return Ok(None),
    };
    // Bitget WS book data is not in BitgetTicker; parse from raw JSON via re-parse.
    let raw: serde_json::Value =
        serde_json::from_str(text).map_err(|e| MarketError::Decode(e.to_string()))?;
    let entries = raw
        .get("data")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .cloned()
        .ok_or_else(|| MarketError::Decode("empty book data".to_string()))?;

    let mut bids = parse_levels(entries.get("bids"));
    let mut asks = parse_levels(entries.get("asks"));
    bids.sort_by(|a, b| b.price.cmp(&a.price));
    asks.sort_by(|a, b| a.price.cmp(&b.price));
    dedupe_levels(&mut bids);
    dedupe_levels(&mut asks);
    bids.truncate(15);
    asks.truncate(15);

    let ts_exchange = entries.get("ts").and_then(value_to_i64);
    let seq = entries.get("seq").map(value_to_string);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // validate data
    for level in bids.iter().chain(asks.iter()) {
        if level.price <= Decimal::ZERO || level.quantity <= Decimal::ZERO {
            return Err(MarketError::Decode("invalid order book level".to_string()));
        }
    }

    Ok(Some(OrderBook {
        symbol,
        bids,
        asks,
        ts_exchange,
        ts_received: now,
        seq,
        source: "websocket".to_string(),
    }))
}

fn parse_levels(value: Option<&serde_json::Value>) -> Vec<OrderBookLevel> {
    let mut out = Vec::new();
    if let Some(arr) = value.and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(pair) = item.as_array() {
                if pair.len() >= 2 {
                    if let (Some(p), Some(q)) = (pair[0].as_str(), pair[1].as_str()) {
                        if let (Ok(price), Ok(quantity)) =
                            (p.parse::<Decimal>(), q.parse::<Decimal>())
                        {
                            out.push(OrderBookLevel { price, quantity });
                        }
                    }
                }
            }
        }
    }
    out
}

fn dedupe_levels(levels: &mut Vec<OrderBookLevel>) {
    let mut seen = std::collections::BTreeSet::new();
    levels.retain(|l| seen.insert(l.price));
}

fn value_to_i64(value: &serde_json::Value) -> Option<i64> {
    match value {
        serde_json::Value::String(s) => s.parse().ok(),
        serde_json::Value::Number(n) => n.as_i64(),
        _ => None,
    }
}

fn value_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}
use rust_decimal::Decimal;
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct BitgetWsEnvelope {
    pub event: Option<String>,
    pub code: Option<String>,
    pub msg: Option<String>,
    pub arg: Option<BitgetWsArg>,
    pub action: Option<String>,
    pub data: Option<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
pub struct BitgetWsArg {
    #[serde(rename = "instType")]
    pub inst_type: Option<String>,
    pub channel: Option<String>,
    #[serde(rename = "instId")]
    pub inst_id: Option<String>,
}

pub fn parse_ticker_message(text: &str) -> Result<Option<Ticker>, MarketError> {
    let env: BitgetWsEnvelope =
        serde_json::from_str(text).map_err(|e| MarketError::Decode(e.to_string()))?;
    if let Some(code) = &env.code {
        if code != "0" {
            return Err(MarketError::Exchange(format!(
                "{} {}",
                code,
                env.msg.unwrap_or_default()
            )));
        }
    }
    if env.event.as_deref() == Some("error") {
        return Err(MarketError::Exchange(env.msg.unwrap_or_default()));
    }
    if env.data.is_none() {
        return Ok(None);
    }
    let data = env
        .data
        .ok_or_else(|| MarketError::Decode("missing data".to_string()))?;
    let arr = data
        .as_array()
        .ok_or_else(|| MarketError::Decode("data is not array".to_string()))?;
    let ticker: crate::market::bitget::types::BitgetTicker = serde_json::from_value(
        arr.first()
            .cloned()
            .ok_or_else(|| MarketError::Decode("empty data".to_string()))?,
    )
    .map_err(|e| MarketError::Decode(e.to_string()))?;
    let ts_exchange = ticker.ts.as_ref().and_then(|v| v.parse::<i64>().ok());
    let last = ticker
        .last_pr
        .as_ref()
        .and_then(|v| v.parse::<Decimal>().ok())
        .ok_or_else(|| MarketError::Decode("missing last".to_string()))?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok(Some(Ticker {
        symbol: ticker.symbol,
        last,
        bid: ticker.bid_pr.as_ref().and_then(|v| v.parse().ok()),
        ask: ticker.ask_pr.as_ref().and_then(|v| v.parse().ok()),
        bid_size: ticker.bid_sz.as_ref().and_then(|v| v.parse().ok()),
        ask_size: ticker.ask_sz.as_ref().and_then(|v| v.parse().ok()),
        high_24h: ticker.high24h.as_ref().and_then(|v| v.parse().ok()),
        low_24h: ticker.low24h.as_ref().and_then(|v| v.parse().ok()),
        change_24h: ticker.change24h.as_ref().and_then(|v| v.parse().ok()),
        base_volume: ticker.base_volume.as_ref().and_then(|v| v.parse().ok()),
        quote_volume: ticker.quote_volume.as_ref().and_then(|v| v.parse().ok()),
        mark_price: ticker.mark_price.as_ref().and_then(|v| v.parse().ok()),
        index_price: ticker.index_price.as_ref().and_then(|v| v.parse().ok()),
        funding_rate: ticker.funding_rate.as_ref().and_then(|v| v.parse().ok()),
        ts_exchange,
        ts_received: now,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_ticker() {
        let msg =
            r#"{"action":"snapshot","data":[{"symbol":"BTCUSDT","lastPr":"100.5","ts":"123"}]}"#;
        let t = parse_ticker_message(msg).unwrap().unwrap();
        assert_eq!(t.symbol, "BTCUSDT");
        assert_eq!(t.last.to_string(), "100.5");
        assert_eq!(t.ts_exchange, Some(123));
    }
}
