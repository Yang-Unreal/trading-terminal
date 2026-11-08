use crate::{market::MarketError, AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

fn map_err(e: MarketError) -> (StatusCode, Json<serde_json::Value>) {
    let status = match e {
        MarketError::InvalidSymbol | MarketError::InvalidProductType => StatusCode::BAD_REQUEST,
        MarketError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
        MarketError::Timeout => StatusCode::GATEWAY_TIMEOUT,
        _ => StatusCode::BAD_GATEWAY,
    };
    (status, Json(serde_json::json!({"error": e.to_string()})))
}

const SUPPORTED_GRANULARITIES: &[&str] = &["1m", "5m", "15m", "1H", "4H", "1D", "1Dutc"];
const MAX_LIMIT: usize = 1000;

#[derive(Deserialize)]
pub struct CandlesQuery {
    pub granularity: String,
    pub limit: Option<usize>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
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

pub async fn trades(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<Vec<crate::market::Trade>>, (StatusCode, Json<serde_json::Value>)> {
    state
        .market
        .get_recent_trades(&symbol)
        .await
        .map(Json)
        .map_err(map_err)
}

pub async fn candles(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
    Query(query): Query<CandlesQuery>,
) -> Result<Json<Vec<crate::market::Candle>>, (StatusCode, Json<serde_json::Value>)> {
    if !SUPPORTED_GRANULARITIES.contains(&query.granularity.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "unsupported granularity"})),
        ));
    }
    let limit = query.limit.unwrap_or(300);
    if limit > MAX_LIMIT {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "limit exceeds maximum"})),
        ));
    }
    state
        .market
        .get_candles(
            &symbol,
            &query.granularity,
            Some(limit),
            query.start_time,
            query.end_time,
        )
        .await
        .map(Json)
        .map_err(map_err)
}

#[derive(Deserialize)]
pub struct HistoryCandlesQuery {
    pub granularity: String,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
}

pub async fn history_candles(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
    Query(query): Query<HistoryCandlesQuery>,
) -> Result<Json<Vec<crate::market::Candle>>, (StatusCode, Json<serde_json::Value>)> {
    if !SUPPORTED_GRANULARITIES.contains(&query.granularity.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "unsupported granularity"})),
        ));
    }
    state
        .market
        .get_history_candles(
            &symbol,
            &query.granularity,
            query.start_time,
            query.end_time,
        )
        .await
        .map(Json)
        .map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn rejects_unsupported_granularity() {
        assert!(SUPPORTED_GRANULARITIES.contains(&"1m"));
        assert!(SUPPORTED_GRANULARITIES.contains(&"5m"));
        assert!(SUPPORTED_GRANULARITIES.contains(&"15m"));
        assert!(SUPPORTED_GRANULARITIES.contains(&"1H"));
        assert!(SUPPORTED_GRANULARITIES.contains(&"4H"));
        assert!(SUPPORTED_GRANULARITIES.contains(&"1D"));
        assert!(SUPPORTED_GRANULARITIES.contains(&"1Dutc"));
        assert!(!SUPPORTED_GRANULARITIES.contains(&"2m"));
        assert!(!SUPPORTED_GRANULARITIES.contains(&"30s"));
        assert!(!SUPPORTED_GRANULARITIES.contains(&"1w"));
    }

    #[test]
    fn enforces_max_limit() {
        assert_eq!(MAX_LIMIT, 1000);
        assert!(1000 <= MAX_LIMIT);
        assert!(1001 > MAX_LIMIT);
    }

    #[test]
    fn default_limit_is_300() {
        let query = CandlesQuery {
            granularity: "1m".to_string(),
            limit: None,
            start_time: None,
            end_time: None,
        };
        let limit = query.limit.unwrap_or(300);
        assert_eq!(limit, 300);
        assert!(limit <= MAX_LIMIT);
    }

    #[tokio::test]
    async fn candles_handler_rejects_unsupported_granularity() {
        std::env::set_var("MASTER_KEY_VERSION", "1");
        std::env::set_var(
            "MASTER_KEY_1",
            base64::engine::general_purpose::STANDARD.encode([7u8; 32]),
        );
        let state = AppState {
            db: sqlx::postgres::PgPool::connect_lazy("postgres://localhost:5432/test")
                .expect("test pool"),
            config: crate::config::Config::parse(vec![(
                "DATABASE_URL".to_string(),
                "postgres://u:p@localhost/db".to_string(),
            )])
            .unwrap(),
            keyring: crate::vault::Keyring::from_env().unwrap(),
            market: crate::market::MarketService::new().unwrap(),
            market_engine: std::sync::Arc::new(crate::market::MarketDataEngine::new(vec![])),
        };
        let query = CandlesQuery {
            granularity: "2m".to_string(),
            limit: None,
            start_time: None,
            end_time: None,
        };
        let result = candles(
            axum::extract::State(state),
            axum::extract::Path("BTCUSDT".to_string()),
            Query(query),
        )
        .await;
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn candles_handler_rejects_limit_above_max() {
        std::env::set_var("MASTER_KEY_VERSION", "1");
        std::env::set_var(
            "MASTER_KEY_1",
            base64::engine::general_purpose::STANDARD.encode([7u8; 32]),
        );
        let state = AppState {
            db: sqlx::postgres::PgPool::connect_lazy("postgres://localhost:5432/test")
                .expect("test pool"),
            config: crate::config::Config::parse(vec![(
                "DATABASE_URL".to_string(),
                "postgres://u:p@localhost/db".to_string(),
            )])
            .unwrap(),
            keyring: crate::vault::Keyring::from_env().unwrap(),
            market: crate::market::MarketService::new().unwrap(),
            market_engine: std::sync::Arc::new(crate::market::MarketDataEngine::new(vec![])),
        };
        let query = CandlesQuery {
            granularity: "1m".to_string(),
            limit: Some(2000),
            start_time: None,
            end_time: None,
        };
        let result = candles(
            axum::extract::State(state),
            axum::extract::Path("BTCUSDT".to_string()),
            Query(query),
        )
        .await;
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
    }
}
