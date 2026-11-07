use reqwest::Client;
use rust_decimal::Decimal;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::sleep;

use crate::market::bitget::types::{
    BitgetContract, BitgetDepthEntry, BitgetOrderBook, BitgetResp, BitgetTicker,
};
use crate::market::errors::MarketError;
use crate::market::models::{Instrument, OrderBook, OrderBookLevel, Ticker};

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

    async fn get(
        &self,
        url: &str,
        params: &[(&str, &str)],
    ) -> Result<reqwest::Response, MarketError> {
        let mut attempts = 0;
        loop {
            let res = self
                .client
                .get(url)
                .query(params)
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
