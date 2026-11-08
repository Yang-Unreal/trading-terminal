use reqwest::Client;
use rust_decimal::Decimal;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::sleep;

use crate::market::bitget::types::{
    BitgetContract, BitgetDepthEntry, BitgetFill, BitgetOrderBook, BitgetResp, BitgetTicker,
};
use crate::market::errors::MarketError;
use crate::market::models::{
    Candle, Instrument, OrderBook, OrderBookLevel, Ticker, Trade, TradeSide,
};

const BASE_URL: &str = "https://api.bitget.com";

#[derive(Clone)]
pub struct BitgetRestClient {
    client: Client,
}

impl BitgetRestClient {
    pub fn new() -> Result<Self, MarketError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .pool_max_idle_per_host(8)
            .build()
            .map_err(|e| MarketError::Http(e.to_string()))?;
        Ok(Self { client })
    }

    pub async fn get_instrument(&self, symbol: &str) -> Result<Instrument, MarketError> {
        let symbol = validate_symbol(symbol)?;
        let url = format!("{BASE_URL}/api/v2/mix/market/contracts");
        let resp = self
            .get(&url, &[("productType", "USDT-FUTURES"), ("symbol", symbol)])
            .await?;
        let parsed: BitgetResp<Vec<BitgetContract>> = resp
            .json()
            .await
            .map_err(|e| MarketError::Decode(e.to_string()))?;
        let contract = parsed
            .data
            .ok_or_else(|| MarketError::Exchange("missing data".to_string()))?
            .into_iter()
            .next()
            .ok_or_else(|| MarketError::Exchange("no contract".to_string()))?;
        if parsed.code != "00000" {
            return Err(MarketError::Exchange(format!(
                "{} {}",
                parsed.code, parsed.msg
            )));
        }
        Ok(normalize_instrument(contract))
    }

    pub async fn get_ticker(&self, symbol: &str) -> Result<Ticker, MarketError> {
        let symbol = validate_symbol(symbol)?;
        let url = format!("{BASE_URL}/api/v2/mix/market/ticker");
        let resp = self
            .get(&url, &[("productType", "USDT-FUTURES"), ("symbol", symbol)])
            .await?;
        let parsed: BitgetResp<BitgetTicker> = resp
            .json()
            .await
            .map_err(|e| MarketError::Decode(e.to_string()))?;
        if parsed.code != "00000" {
            return Err(MarketError::Exchange(format!(
                "{} {}",
                parsed.code, parsed.msg
            )));
        }
        let ticker = parsed
            .data
            .ok_or_else(|| MarketError::Exchange("missing data".to_string()))?;
        Ok(normalize_ticker(ticker)?)
    }

    pub async fn get_order_book(&self, symbol: &str) -> Result<OrderBook, MarketError> {
        let symbol = validate_symbol(symbol)?;
        let url = format!("{BASE_URL}/api/v2/mix/market/merge-depth");
        let resp = self
            .get(
                &url,
                &[
                    ("productType", "USDT-FUTURES"),
                    ("symbol", symbol),
                    ("precision", "scale0"),
                    ("limit", "50"),
                ],
            )
            .await?;
        let parsed: BitgetResp<BitgetOrderBook> = resp
            .json()
            .await
            .map_err(|e| MarketError::Decode(e.to_string()))?;
        if parsed.code != "00000" {
            return Err(MarketError::Exchange(format!(
                "{} {}",
                parsed.code, parsed.msg
            )));
        }
        let book = parsed
            .data
            .ok_or_else(|| MarketError::Exchange("missing data".to_string()))?;
        Ok(normalize_order_book(symbol, book))
    }

    pub async fn get_recent_trades(&self, symbol: &str) -> Result<Vec<Trade>, MarketError> {
        let symbol = validate_symbol(symbol)?;
        let url = format!("{BASE_URL}/api/v2/mix/market/fills");
        let resp = self
            .get(
                &url,
                &[
                    ("productType", "USDT-FUTURES"),
                    ("symbol", symbol),
                    ("limit", "100"),
                ],
            )
            .await?;
        let parsed: BitgetResp<Vec<BitgetFill>> = resp
            .json()
            .await
            .map_err(|e| MarketError::Decode(e.to_string()))?;
        if parsed.code != "00000" {
            return Err(MarketError::Exchange(format!(
                "{} {}",
                parsed.code, parsed.msg
            )));
        }
        let fills = parsed.data.unwrap_or_default();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let mut trades = Vec::new();
        for fill in fills {
            let trade_id = fill
                .trade_id
                .clone()
                .unwrap_or_else(|| format!("{}-{}", symbol, now));
            let price = fill
                .price
                .as_ref()
                .and_then(|v| v.trim().parse::<Decimal>().ok())
                .ok_or_else(|| MarketError::Decode("missing price".to_string()))?;
            let size = fill
                .size
                .as_ref()
                .and_then(|v| v.trim().parse::<Decimal>().ok())
                .ok_or_else(|| MarketError::Decode("missing size".to_string()))?;
            let side = match fill.side.as_deref() {
                Some("buy") | Some("Buy") | Some("BUY") => TradeSide::Buy,
                Some("sell") | Some("Sell") | Some("SELL") => TradeSide::Sell,
                _ => continue,
            };
            let ts_exchange = fill.ts.as_ref().and_then(|v| v.parse::<i64>().ok());
            trades.push(Trade {
                trade_id,
                symbol: symbol.to_string(),
                price,
                size,
                side,
                ts_exchange,
                ts_received: now,
                source: "rest".to_string(),
            });
        }
        trades.sort_by(|a, b| b.ts_exchange.unwrap_or(0).cmp(&a.ts_exchange.unwrap_or(0)));
        Ok(trades)
    }

    pub async fn get_candles(
        &self,
        symbol: &str,
        granularity: &str,
        limit: Option<usize>,
        start_time: Option<i64>,
        end_time: Option<i64>,
    ) -> Result<Vec<Candle>, MarketError> {
        let symbol = validate_symbol(symbol)?;
        let mut params: Vec<(&str, String)> = vec![
            ("productType", "USDT-FUTURES".to_string()),
            ("symbol", symbol.to_string()),
            ("granularity", granularity.to_string()),
        ];
        if let Some(limit) = limit {
            params.push(("limit", limit.to_string()));
        }
        if let Some(start) = start_time {
            params.push(("startTime", start.to_string()));
        }
        if let Some(end) = end_time {
            params.push(("endTime", end.to_string()));
        }
        let url = format!("{BASE_URL}/api/v2/mix/market/candles");
        let resp = self.get_params(&url, &params).await?;
        let parsed: BitgetResp<Vec<Vec<String>>> = resp
            .json()
            .await
            .map_err(|e| MarketError::Decode(e.to_string()))?;
        if parsed.code != "00000" {
            return Err(MarketError::Exchange(format!(
                "{} {}",
                parsed.code, parsed.msg
            )));
        }
        let rows = parsed.data.unwrap_or_default();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Self::parse_candle_rows(symbol, granularity, rows, now)
    }

    pub async fn get_history_candles(
        &self,
        symbol: &str,
        granularity: &str,
        start_time: Option<i64>,
        end_time: Option<i64>,
    ) -> Result<Vec<Candle>, MarketError> {
        let symbol = validate_symbol(symbol)?;
        let mut params: Vec<(&str, String)> = vec![
            ("productType", "USDT-FUTURES".to_string()),
            ("symbol", symbol.to_string()),
            ("granularity", granularity.to_string()),
        ];
        if let Some(start) = start_time {
            params.push(("startTime", start.to_string()));
        }
        if let Some(end) = end_time {
            params.push(("endTime", end.to_string()));
        }
        let url = format!("{BASE_URL}/api/v2/mix/market/history-candles");
        let resp = self.get_params(&url, &params).await?;
        let parsed: BitgetResp<Vec<Vec<String>>> = resp
            .json()
            .await
            .map_err(|e| MarketError::Decode(e.to_string()))?;
        if parsed.code != "00000" {
            return Err(MarketError::Exchange(format!(
                "{} {}",
                parsed.code, parsed.msg
            )));
        }
        let rows = parsed.data.unwrap_or_default();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Self::parse_candle_rows(symbol, granularity, rows, now)
    }

    fn parse_candle_rows(
        symbol: &str,
        granularity: &str,
        rows: Vec<Vec<String>>,
        ts_received: i64,
    ) -> Result<Vec<Candle>, MarketError> {
        let mut candles = Vec::new();
        for row in rows {
            if row.len() < 7 {
                continue;
            }
            let start_time = row[0]
                .trim()
                .parse::<i64>()
                .map_err(|_| MarketError::Decode("invalid timestamp".to_string()))?;
            let open = row[1]
                .trim()
                .parse::<Decimal>()
                .map_err(|_| MarketError::Decode("invalid open".to_string()))?;
            let high = row[2]
                .trim()
                .parse::<Decimal>()
                .map_err(|_| MarketError::Decode("invalid high".to_string()))?;
            let low = row[3]
                .trim()
                .parse::<Decimal>()
                .map_err(|_| MarketError::Decode("invalid low".to_string()))?;
            let close = row[4]
                .trim()
                .parse::<Decimal>()
                .map_err(|_| MarketError::Decode("invalid close".to_string()))?;
            let base_volume = row[5]
                .trim()
                .parse::<Decimal>()
                .map_err(|_| MarketError::Decode("invalid base volume".to_string()))?;
            let quote_volume = row[6]
                .trim()
                .parse::<Decimal>()
                .map_err(|_| MarketError::Decode("invalid quote volume".to_string()))?;
            let usdt_volume = row.get(7).and_then(|v| v.trim().parse::<Decimal>().ok());

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
                symbol: symbol.to_string(),
                granularity: granularity.to_string(),
                start_time,
                open,
                high,
                low,
                close,
                base_volume,
                quote_volume,
                usdt_volume,
                ts_received,
                source: "rest".to_string(),
            });
        }
        candles.sort_by(|a, b| a.start_time.cmp(&b.start_time));
        Ok(candles)
    }

    async fn get(
        &self,
        url: &str,
        params: &[(&str, &str)],
    ) -> Result<reqwest::Response, MarketError> {
        let params: Vec<(&str, String)> = params.iter().map(|(k, v)| (*k, v.to_string())).collect();
        self.get_params(url, &params).await
    }

    async fn get_params(
        &self,
        url: &str,
        params: &[(&str, String)],
    ) -> Result<reqwest::Response, MarketError> {
        let mut attempts = 0;
        loop {
            let res = self
                .client
                .get(url)
                .query(&params)
                .send()
                .await
                .map_err(map_reqwest_error)?;
            let status = res.status();
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                if attempts >= 3 {
                    return Err(MarketError::RateLimited);
                }
                attempts += 1;
                let delay = res
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(1);
                sleep(Duration::from_secs(delay.min(5))).await;
                continue;
            }
            if !status.is_success() {
                return Err(MarketError::Http(format!("status {status}")));
            }
            return Ok(res);
        }
    }
}

fn map_reqwest_error(e: reqwest::Error) -> MarketError {
    if e.is_timeout() {
        MarketError::Timeout
    } else {
        MarketError::Http(e.to_string())
    }
}

fn validate_symbol(s: &str) -> Result<&str, MarketError> {
    let s = s.trim();
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(MarketError::InvalidSymbol);
    }
    Ok(s)
}

fn parse_dec(s: &Option<String>) -> Option<Decimal> {
    s.as_ref().and_then(|v| v.trim().parse::<Decimal>().ok())
}

fn normalize_instrument(c: BitgetContract) -> Instrument {
    Instrument {
        symbol: c.symbol,
        base_coin: c.base_coin,
        quote_coin: c.quote_coin,
        price_precision: c.price_place.and_then(|v| v.parse().ok()).unwrap_or(0),
        quantity_precision: c.volume_place.and_then(|v| v.parse().ok()).unwrap_or(0),
        min_trade_num: parse_dec(&c.min_trade_num),
        min_trade_usdt: parse_dec(&c.min_trade_usdt),
        max_lever: c.max_lever.and_then(|v| v.parse().ok()),
        status: c.symbol_status.unwrap_or_default(),
    }
}

fn normalize_ticker(t: BitgetTicker) -> Result<Ticker, MarketError> {
    let ts_exchange = t.ts.as_ref().and_then(|v| v.parse::<i64>().ok());
    let last = parse_dec(&t.last_pr)
        .ok_or_else(|| MarketError::Decode("missing last price".to_string()))?;
    let ticker = Ticker {
        symbol: t.symbol,
        last,
        bid: parse_dec(&t.bid_pr),
        ask: parse_dec(&t.ask_pr),
        bid_size: parse_dec(&t.bid_sz),
        ask_size: parse_dec(&t.ask_sz),
        high_24h: parse_dec(&t.high24h),
        low_24h: parse_dec(&t.low24h),
        change_24h: parse_dec(&t.change24h),
        base_volume: parse_dec(&t.base_volume),
        quote_volume: parse_dec(&t.quote_volume),
        mark_price: parse_dec(&t.mark_price),
        index_price: parse_dec(&t.index_price),
        funding_rate: parse_dec(&t.funding_rate),
        ts_exchange,
        ts_received: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    };
    Ok(ticker)
}

fn normalize_order_book(symbol: &str, b: BitgetOrderBook) -> OrderBook {
    let parse_level = |e: BitgetDepthEntry| -> Option<OrderBookLevel> {
        let price = e.0.parse::<Decimal>().ok()?;
        let qty = e.1.parse::<Decimal>().ok()?;
        Some(OrderBookLevel {
            price,
            quantity: qty,
        })
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    OrderBook {
        symbol: symbol.to_string(),
        bids: b
            .bids
            .unwrap_or_default()
            .into_iter()
            .filter_map(parse_level)
            .collect(),
        asks: b
            .asks
            .unwrap_or_default()
            .into_iter()
            .filter_map(parse_level)
            .collect(),
        ts_exchange: b.ts.as_ref().and_then(|v| v.parse::<i64>().ok()),
        ts_received: now,
        seq: None,
        source: "rest".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rest_candle_7_fields() {
        let rows = vec![vec![
            "1790000000000".to_string(),
            "100000".to_string(),
            "100100".to_string(),
            "99900".to_string(),
            "100050".to_string(),
            "12.5".to_string(),
            "1250000".to_string(),
        ]];
        let candles =
            BitgetRestClient::parse_candle_rows("BTCUSDT", "1m", rows, 1790000000000).unwrap();
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
        assert_eq!(c.usdt_volume, None);
        assert_eq!(c.source, "rest");
    }

    #[test]
    fn parses_rest_candle_8_fields_with_usdt() {
        let rows = vec![vec![
            "1790000000000".to_string(),
            "100000".to_string(),
            "100100".to_string(),
            "99900".to_string(),
            "100050".to_string(),
            "12.5".to_string(),
            "1250000".to_string(),
            "1250000".to_string(),
        ]];
        let candles =
            BitgetRestClient::parse_candle_rows("BTCUSDT", "1m", rows, 1790000000000).unwrap();
        assert_eq!(candles.len(), 1);
        assert_eq!(candles[0].usdt_volume.unwrap().to_string(), "1250000");
    }

    #[test]
    fn parses_rest_candle_multiple_rows_sorted() {
        let rows = vec![
            vec![
                "1790000000200".to_string(),
                "100200".to_string(),
                "100300".to_string(),
                "100100".to_string(),
                "100250".to_string(),
                "15.0".to_string(),
                "1502000".to_string(),
            ],
            vec![
                "1790000000000".to_string(),
                "100000".to_string(),
                "100100".to_string(),
                "99900".to_string(),
                "100050".to_string(),
                "12.5".to_string(),
                "1250000".to_string(),
            ],
        ];
        let candles =
            BitgetRestClient::parse_candle_rows("BTCUSDT", "1m", rows, 1790000000000).unwrap();
        assert_eq!(candles.len(), 2);
        assert_eq!(candles[0].start_time, 1790000000000);
        assert_eq!(candles[1].start_time, 1790000000200);
    }

    #[test]
    fn rejects_rest_candle_invalid_decimal() {
        let rows = vec![vec![
            "1790000000000".to_string(),
            "not-a-number".to_string(),
            "100100".to_string(),
            "99900".to_string(),
            "100050".to_string(),
            "12.5".to_string(),
            "1250000".to_string(),
        ]];
        assert!(BitgetRestClient::parse_candle_rows("BTCUSDT", "1m", rows, 1790000000000).is_err());
    }

    #[test]
    fn rejects_rest_candle_invalid_timestamp() {
        let rows = vec![vec![
            "not-a-timestamp".to_string(),
            "100000".to_string(),
            "100100".to_string(),
            "99900".to_string(),
            "100050".to_string(),
            "12.5".to_string(),
            "1250000".to_string(),
        ]];
        assert!(BitgetRestClient::parse_candle_rows("BTCUSDT", "1m", rows, 1790000000000).is_err());
    }

    #[test]
    fn rejects_rest_candle_high_lt_low() {
        let rows = vec![vec![
            "1790000000000".to_string(),
            "100000".to_string(),
            "99900".to_string(),
            "100100".to_string(),
            "100050".to_string(),
            "12.5".to_string(),
            "1250000".to_string(),
        ]];
        assert!(BitgetRestClient::parse_candle_rows("BTCUSDT", "1m", rows, 1790000000000).is_err());
    }

    #[test]
    fn rejects_rest_candle_open_out_of_range() {
        let rows = vec![vec![
            "1790000000000".to_string(),
            "100200".to_string(),
            "100100".to_string(),
            "99900".to_string(),
            "100050".to_string(),
            "12.5".to_string(),
            "1250000".to_string(),
        ]];
        assert!(BitgetRestClient::parse_candle_rows("BTCUSDT", "1m", rows, 1790000000000).is_err());
    }

    #[test]
    fn rejects_rest_candle_negative_volume() {
        let rows = vec![vec![
            "1790000000000".to_string(),
            "100000".to_string(),
            "100100".to_string(),
            "99900".to_string(),
            "100050".to_string(),
            "-12.5".to_string(),
            "1250000".to_string(),
        ]];
        assert!(BitgetRestClient::parse_candle_rows("BTCUSDT", "1m", rows, 1790000000000).is_err());
    }

    #[test]
    fn skips_rest_candle_fewer_than_7_fields() {
        let rows = vec![vec![
            "1790000000000".to_string(),
            "100000".to_string(),
            "100100".to_string(),
        ]];
        let candles =
            BitgetRestClient::parse_candle_rows("BTCUSDT", "1m", rows, 1790000000000).unwrap();
        assert!(candles.is_empty());
    }
}
