use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instrument {
    pub symbol: String,
    pub base_coin: String,
    pub quote_coin: String,
    pub price_precision: i32,
    pub quantity_precision: i32,
    pub min_trade_num: Option<Decimal>,
    pub min_trade_usdt: Option<Decimal>,
    pub max_lever: Option<i32>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticker {
    pub symbol: String,
    pub last: Decimal,
    pub bid: Option<Decimal>,
    pub ask: Option<Decimal>,
    pub bid_size: Option<Decimal>,
    pub ask_size: Option<Decimal>,
    pub high_24h: Option<Decimal>,
    pub low_24h: Option<Decimal>,
    pub change_24h: Option<Decimal>,
    pub base_volume: Option<Decimal>,
    pub quote_volume: Option<Decimal>,
    pub mark_price: Option<Decimal>,
    pub index_price: Option<Decimal>,
    pub funding_rate: Option<Decimal>,
    pub ts_exchange: Option<i64>,
    pub ts_received: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TradeSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub trade_id: String,
    pub symbol: String,
    pub price: Decimal,
    pub size: Decimal,
    pub side: TradeSide,
    pub ts_exchange: Option<i64>,
    pub ts_received: i64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookLevel {
    pub price: Decimal,
    pub quantity: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: String,
    pub bids: Vec<OrderBookLevel>,
    pub asks: Vec<OrderBookLevel>,
    pub ts_exchange: Option<i64>,
    pub ts_received: i64,
    pub seq: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candle {
    pub symbol: String,
    pub granularity: String,
    pub start_time: i64,
    pub open: Decimal,
    pub high: Decimal,
    pub low: Decimal,
    pub close: Decimal,
    pub base_volume: Decimal,
    pub quote_volume: Decimal,
    pub usdt_volume: Option<Decimal>,
    pub ts_received: i64,
    pub source: String,
}
