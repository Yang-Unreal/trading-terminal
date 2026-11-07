use crate::{market::MarketError, AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

fn map_err(e: MarketError) -> (StatusCode, Json<serde_json::Value>) {
    let status = match e {
        MarketError::InvalidSymbol | MarketError::InvalidProductType => StatusCode::BAD_REQUEST,
        MarketError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
        MarketError::Timeout => StatusCode::GATEWAY_TIMEOUT,
        _ => StatusCode::BAD_GATEWAY,
    };
    (status, Json(serde_json::json!({"error": e.to_string()})))
}

pub async fn instrument(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<crate::market::Instrument>, (StatusCode, Json<serde_json::Value>)> {
    state
        .market
        .get_instrument(&symbol)
        .await
        .map(Json)
        .map_err(map_err)
}

pub async fn ticker(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<crate::market::Ticker>, (StatusCode, Json<serde_json::Value>)> {
    state
        .market
        .get_ticker(&symbol)
        .await
        .map(Json)
        .map_err(map_err)
}

pub async fn orderbook(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<crate::market::OrderBook>, (StatusCode, Json<serde_json::Value>)> {
    state
        .market
        .get_order_book(&symbol)
        .await
        .map(Json)
        .map_err(map_err)
}
