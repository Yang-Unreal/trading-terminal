use crate::market::{BitgetRestClient, Instrument, MarketError, OrderBook, Ticker};

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
}
