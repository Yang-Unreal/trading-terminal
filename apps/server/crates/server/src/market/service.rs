use crate::market::{BitgetRestClient, Candle, Instrument, MarketError, OrderBook, Ticker, Trade};

#[derive(Clone)]
pub struct MarketService {
    client: BitgetRestClient,
}

impl MarketService {
    pub fn new() -> Result<Self, MarketError> {
        Ok(Self {
            client: BitgetRestClient::new()?,
        })
    }

    pub async fn get_instrument(&self, symbol: &str) -> Result<Instrument, MarketError> {
        self.client.get_instrument(symbol).await
    }

    pub async fn get_ticker(&self, symbol: &str) -> Result<Ticker, MarketError> {
        self.client.get_ticker(symbol).await
    }

    pub async fn get_order_book(&self, symbol: &str) -> Result<OrderBook, MarketError> {
        self.client.get_order_book(symbol).await
    }

    pub async fn get_recent_trades(&self, symbol: &str) -> Result<Vec<Trade>, MarketError> {
        self.client.get_recent_trades(symbol).await
    }

    pub async fn get_candles(
        &self,
        symbol: &str,
        granularity: &str,
        limit: Option<usize>,
        start_time: Option<i64>,
        end_time: Option<i64>,
    ) -> Result<Vec<Candle>, MarketError> {
        self.client
            .get_candles(symbol, granularity, limit, start_time, end_time)
            .await
    }

    pub async fn get_history_candles(
        &self,
        symbol: &str,
        granularity: &str,
        start_time: Option<i64>,
        end_time: Option<i64>,
    ) -> Result<Vec<Candle>, MarketError> {
        self.client
            .get_history_candles(symbol, granularity, start_time, end_time)
            .await
    }
}
