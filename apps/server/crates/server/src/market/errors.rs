use thiserror::Error;

#[derive(Debug, Error)]
pub enum MarketError {
    #[error("invalid symbol")]
    InvalidSymbol,
    #[error("invalid product type")]
    InvalidProductType,
    #[error("exchange error: {0}")]
    Exchange(String),
    #[error("http error: {0}")]
    Http(String),
    #[error("decode error: {0}")]
    Decode(String),
    #[error("timeout")]
    Timeout,
    #[error("rate limited")]
    RateLimited,
}
