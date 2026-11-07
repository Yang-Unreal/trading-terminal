use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct BitgetResp<T> {
    pub code: String,
    pub msg: String,
    pub data: Option<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitgetContract {
    pub symbol: String,
    pub base_coin: String,
    pub quote_coin: String,
    pub price_place: Option<String>,
    pub volume_place: Option<String>,
    pub min_trade_num: Option<String>,
    pub min_trade_usdt: Option<String>,
    pub max_lever: Option<String>,
    pub symbol_status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitgetTicker {
    pub symbol: String,
    pub last_pr: Option<String>,
    pub bid_pr: Option<String>,
    pub ask_pr: Option<String>,
    pub bid_sz: Option<String>,
    pub ask_sz: Option<String>,
    pub high24h: Option<String>,
    pub low24h: Option<String>,
    pub change24h: Option<String>,
    pub base_volume: Option<String>,
    pub quote_volume: Option<String>,
    pub mark_price: Option<String>,
    pub index_price: Option<String>,
    pub funding_rate: Option<String>,
    pub ts: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BitgetDepthEntry(pub String, pub String);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitgetOrderBook {
    pub asks: Option<Vec<BitgetDepthEntry>>,
    pub bids: Option<Vec<BitgetDepthEntry>>,
    pub ts: Option<String>,
}
