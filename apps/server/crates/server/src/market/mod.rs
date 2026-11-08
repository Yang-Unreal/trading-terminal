pub mod api;
pub mod bitget;
pub mod engine;
pub use engine::MarketDataEngine;
pub mod errors;
pub mod models;
pub mod service;
pub mod ws;

pub use bitget::rest::BitgetRestClient;
pub use errors::MarketError;
pub use models::{Candle, Instrument, OrderBook, Ticker, Trade};
pub use service::MarketService;
