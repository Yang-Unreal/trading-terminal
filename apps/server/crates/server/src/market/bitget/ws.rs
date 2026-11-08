use crate::market::errors::MarketError;
use crate::market::models::{Candle, OrderBook, OrderBookLevel, Ticker, Trade, TradeSide};
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

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct BitgetTrade {
    pub trade_id: Option<String>,
    pub price: Option<String>,
    pub size: Option<String>,
    pub side: Option<String>,
    pub ts: Option<String>,
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

pub fn parse_trade_message(text: &str) -> Result<Option<Vec<Trade>>, MarketError> {
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
    if channel != "trade" {
        return Ok(None);
    }
    let symbol = arg
        .and_then(|a| a.inst_id.clone())
        .unwrap_or_else(|| "BTCUSDT".to_string());
    let data = match env.data {
        Some(d) if d.as_array().map(|a| !a.is_empty()).unwrap_or(false) => d,
        _ => return Ok(None),
    };
    let mut trades = Vec::new();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    for item in data
        .as_array()
        .ok_or_else(|| MarketError::Decode("data is not array".to_string()))?
    {
        let trade_id = item
            .get("tradeId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{}-{}", symbol, now));
        let price_str = item
            .get("price")
            .and_then(|v| v.as_str())
            .ok_or_else(|| MarketError::Decode("missing price".to_string()))?;
        let size_str = item
            .get("size")
            .and_then(|v| v.as_str())
            .ok_or_else(|| MarketError::Decode("missing size".to_string()))?;
        let side_str = item
            .get("side")
            .and_then(|v| v.as_str())
            .ok_or_else(|| MarketError::Decode("missing side".to_string()))?;
        let price = price_str
            .trim()
            .parse::<Decimal>()
            .map_err(|_| MarketError::Decode("invalid price".to_string()))?;
        let size = size_str
            .trim()
            .parse::<Decimal>()
            .map_err(|_| MarketError::Decode("invalid size".to_string()))?;
        let side = match side_str {
            "buy" | "Buy" | "BUY" => TradeSide::Buy,
            "sell" | "Sell" | "SELL" => TradeSide::Sell,
            _ => return Err(MarketError::Decode("invalid side".to_string())),
        };
        if price <= Decimal::ZERO || size <= Decimal::ZERO {
            return Err(MarketError::Decode(
                "invalid trade price or size".to_string(),
            ));
        }
        let ts_exchange = item
            .get("ts")
            .and_then(|v| v.as_str())
            .and_then(|v| v.parse::<i64>().ok());
        trades.push(Trade {
            trade_id,
            symbol: symbol.clone(),
            price,
            size,
            side,
            ts_exchange,
            ts_received: now,
            source: "websocket".to_string(),
        });
    }
    if trades.is_empty() {
        return Ok(None);
    }
    Ok(Some(trades))
}

pub fn parse_candle_message(text: &str) -> Result<Option<Vec<Candle>>, MarketError> {
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
    if !channel.starts_with("candle") {
        return Ok(None);
    }
    let symbol = arg
        .and_then(|a| a.inst_id.clone())
        .unwrap_or_else(|| "BTCUSDT".to_string());
    let granularity = channel.strip_prefix("candle").unwrap_or("").to_string();
    let data = match env.data {
        Some(d) if d.is_array() && !d.as_array().unwrap().is_empty() => d,
        _ => return Ok(None),
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let mut candles = Vec::new();
    let arr = data
        .as_array()
        .ok_or_else(|| MarketError::Decode("data is not array".to_string()))?;
    for item in arr {
        let row = item
            .as_array()
            .ok_or_else(|| MarketError::Decode("candle row is not array".to_string()))?;
        if row.len() < 7 {
            return Err(MarketError::Decode(
                "candle row has fewer than 7 fields".to_string(),
            ));
        }
        let start_time = row[0]
            .as_str()
            .ok_or_else(|| MarketError::Decode("invalid timestamp".to_string()))?
            .trim()
            .parse::<i64>()
            .map_err(|_| MarketError::Decode("invalid timestamp".to_string()))?;
        let open = row[1]
            .as_str()
            .ok_or_else(|| MarketError::Decode("invalid open".to_string()))?
            .trim()
            .parse::<Decimal>()
            .map_err(|_| MarketError::Decode("invalid open".to_string()))?;
        let high = row[2]
            .as_str()
            .ok_or_else(|| MarketError::Decode("invalid high".to_string()))?
            .trim()
            .parse::<Decimal>()
            .map_err(|_| MarketError::Decode("invalid high".to_string()))?;
        let low = row[3]
            .as_str()
            .ok_or_else(|| MarketError::Decode("invalid low".to_string()))?
            .trim()
            .parse::<Decimal>()
            .map_err(|_| MarketError::Decode("invalid low".to_string()))?;
        let close = row[4]
            .as_str()
            .ok_or_else(|| MarketError::Decode("invalid close".to_string()))?
            .trim()
            .parse::<Decimal>()
            .map_err(|_| MarketError::Decode("invalid close".to_string()))?;
        let base_volume = row[5]
            .as_str()
            .ok_or_else(|| MarketError::Decode("invalid base volume".to_string()))?
            .trim()
            .parse::<Decimal>()
            .map_err(|_| MarketError::Decode("invalid base volume".to_string()))?;
        let quote_volume = row[6]
            .as_str()
            .ok_or_else(|| MarketError::Decode("invalid quote volume".to_string()))?
            .trim()
            .parse::<Decimal>()
            .map_err(|_| MarketError::Decode("invalid quote volume".to_string()))?;
        let usdt_volume = row
            .get(7)
            .and_then(|v| v.as_str())
            .and_then(|v| v.trim().parse::<Decimal>().ok());

        if high < low {
            return Err(MarketError::Decode("high < low".to_string()));
        }
        if open < low || open > high {
            return Err(MarketError::Decode("open out of range".to_string()));
        }
        if close < low || close > high {
            return Err(MarketError::Decode("close out of range".to_string()));
        }
        if base_volume.is_sign_negative() || quote_volume.is_sign_negative() {
            return Err(MarketError::Decode("negative volume".to_string()));
        }

        candles.push(Candle {
            symbol: symbol.clone(),
            granularity: granularity.clone(),
            start_time,
            open,
            high,
            low,
            close,
            base_volume,
            quote_volume,
            usdt_volume,
            ts_received: now,
            source: "websocket".to_string(),
        });
    }
    if candles.is_empty() {
        return Ok(None);
    }
    Ok(Some(candles))
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

    #[test]
    fn parses_trade_buy() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"trade","instId":"BTCUSDT"},"data":[{"tradeId":"1001","price":"75759.3","size":"0.001","side":"buy","ts":"1794117932000"}]}"#;
        let trades = parse_trade_message(msg).unwrap().unwrap();
        assert_eq!(trades.len(), 1);
        let t = &trades[0];
        assert_eq!(t.trade_id, "1001");
        assert_eq!(t.symbol, "BTCUSDT");
        assert_eq!(t.price.to_string(), "75759.3");
        assert_eq!(t.size.to_string(), "0.001");
        assert_eq!(t.side, TradeSide::Buy);
        assert_eq!(t.ts_exchange, Some(1794117932000));
        assert_eq!(t.source, "websocket");
    }

    #[test]
    fn parses_trade_sell() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"trade","instId":"BTCUSDT"},"data":[{"tradeId":"1002","price":"75760.1","size":"0.5","side":"sell","ts":"1794117933000"}]}"#;
        let trades = parse_trade_message(msg).unwrap().unwrap();
        assert_eq!(trades.len(), 1);
        let t = &trades[0];
        assert_eq!(t.side, TradeSide::Sell);
        assert_eq!(t.price.to_string(), "75760.1");
        assert_eq!(t.size.to_string(), "0.5");
    }

    #[test]
    fn rejects_invalid_side() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"trade","instId":"BTCUSDT"},"data":[{"tradeId":"1003","price":"75759.3","size":"0.001","side":"invalid","ts":"1794117932000"}]}"#;
        assert!(parse_trade_message(msg).is_err());
    }

    #[test]
    fn ignores_non_trade_channel() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"ticker","instId":"BTCUSDT"},"data":[{"symbol":"BTCUSDT","lastPr":"100"}]}"#;
        assert!(parse_trade_message(msg).unwrap().is_none());
    }

    #[test]
    fn parses_ws_candle_8_fields() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"candle1m","instId":"BTCUSDT"},"data":[["1790000000000","100000","100100","99900","100050","12.5","1250000","1250000"]]}"#;
        let candles = parse_candle_message(msg).unwrap().unwrap();
        assert_eq!(candles.len(), 1);
        let c = &candles[0];
        assert_eq!(c.symbol, "BTCUSDT");
        assert_eq!(c.granularity, "1m");
        assert_eq!(c.start_time, 1790000000000);
        assert_eq!(c.open.to_string(), "100000");
        assert_eq!(c.high.to_string(), "100100");
        assert_eq!(c.low.to_string(), "99900");
        assert_eq!(c.close.to_string(), "100050");
        assert_eq!(c.base_volume.to_string(), "12.5");
        assert_eq!(c.quote_volume.to_string(), "1250000");
        assert_eq!(c.usdt_volume.unwrap().to_string(), "1250000");
        assert_eq!(c.source, "websocket");
    }

    #[test]
    fn parses_ws_candle_7_fields_no_usdt() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"candle5m","instId":"BTCUSDT"},"data":[["1790000000000","100000","100100","99900","100050","12.5","1250000"]]}"#;
        let candles = parse_candle_message(msg).unwrap().unwrap();
        assert_eq!(candles.len(), 1);
        let c = &candles[0];
        assert_eq!(c.granularity, "5m");
        assert_eq!(c.usdt_volume, None);
    }

    #[test]
    fn parses_ws_candle_multiple_rows() {
        let msg = r#"{"action":"update","arg":{"instType":"USDT-FUTURES","channel":"candle1m","instId":"BTCUSDT"},"data":[["1790000000000","100000","100100","99900","100050","12.5","1250000","1250000"],["1790000060000","100050","100200","100000","100150","15.0","1502000","1502000"]]}"#;
        let candles = parse_candle_message(msg).unwrap().unwrap();
        assert_eq!(candles.len(), 2);
        assert_eq!(candles[0].start_time, 1790000000000);
        assert_eq!(candles[1].start_time, 1790000060000);
    }

    #[test]
    fn rejects_ws_candle_invalid_decimal() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"candle1m","instId":"BTCUSDT"},"data":[["1790000000000","not-a-number","100100","99900","100050","12.5","1250000","1250000"]]}"#;
        assert!(parse_candle_message(msg).is_err());
    }

    #[test]
    fn rejects_ws_candle_invalid_timestamp() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"candle1m","instId":"BTCUSDT"},"data":[["not-a-timestamp","100000","100100","99900","100050","12.5","1250000","1250000"]]}"#;
        assert!(parse_candle_message(msg).is_err());
    }

    #[test]
    fn rejects_ws_candle_high_lt_low() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"candle1m","instId":"BTCUSDT"},"data":[["1790000000000","100000","99900","100100","100050","12.5","1250000","1250000"]]}"#;
        assert!(parse_candle_message(msg).is_err());
    }

    #[test]
    fn rejects_ws_candle_open_out_of_range() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"candle1m","instId":"BTCUSDT"},"data":[["1790000000000","100200","100100","99900","100050","12.5","1250000","1250000"]]}"#;
        assert!(parse_candle_message(msg).is_err());
    }

    #[test]
    fn rejects_ws_candle_close_out_of_range() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"candle1m","instId":"BTCUSDT"},"data":[["1790000000000","100000","100100","99900","100200","12.5","1250000","1250000"]]}"#;
        assert!(parse_candle_message(msg).is_err());
    }

    #[test]
    fn rejects_ws_candle_negative_volume() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"candle1m","instId":"BTCUSDT"},"data":[["1790000000000","100000","100100","99900","100050","-12.5","1250000","1250000"]]}"#;
        assert!(parse_candle_message(msg).is_err());
    }

    #[test]
    fn ignores_ws_non_candle_channel() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"ticker","instId":"BTCUSDT"},"data":[["1790000000000","100000","100100","99900","100050","12.5","1250000","1250000"]]}"#;
        assert!(parse_candle_message(msg).unwrap().is_none());
    }

    #[test]
    fn rejects_ws_candle_fewer_than_7_fields() {
        let msg = r#"{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"candle1m","instId":"BTCUSDT"},"data":[["1790000000000","100000","100100","99900","100050"]]}"#;
        assert!(parse_candle_message(msg).is_err());
    }
}
