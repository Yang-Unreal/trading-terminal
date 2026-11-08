use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Error as SqlxError;
use tower_sessions::Session;

use crate::auth::{
    constant_time_eq, extract_csrf_header, origin_allowed, SESSION_CSRF_KEY, SESSION_USER_KEY,
};
use crate::AppState;

const SUPPORTED_GRANULARITIES: &[&str] = &["1m", "5m", "15m", "1H", "4H", "1Dutc"];
const DEFAULT_GRANULARITY: &str = "1m";

#[derive(Serialize)]
pub struct PreferencesResponse {
    pub chart_granularity: String,
}

#[derive(Deserialize)]
pub struct PreferencesPatch {
    pub chart_granularity: String,
}

fn error_json(status: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({"error": message})))
}

pub async fn get_preferences(
    State(state): State<AppState>,
    session: Session,
) -> Result<Json<PreferencesResponse>, (StatusCode, Json<serde_json::Value>)> {
    let user_id: Option<String> = session
        .get(SESSION_USER_KEY)
        .await
        .map_err(|_| error_json(StatusCode::INTERNAL_SERVER_ERROR, "session error"))?;
    let id_str = match user_id {
        Some(id) => id,
        None => {
            return Err(error_json(StatusCode::UNAUTHORIZED, "unauthenticated"));
        }
    };

    let uid = uuid::Uuid::parse_str(&id_str)
        .map_err(|_| error_json(StatusCode::UNAUTHORIZED, "invalid user"))?;

    let row: Option<(String,)> =
        sqlx::query_as("SELECT chart_granularity FROM user_preferences WHERE user_id = $1")
            .bind(uid)
            .fetch_optional(&state.db)
            .await
            .map_err(|e: SqlxError| {
                error_json(StatusCode::INTERNAL_SERVER_ERROR, &format!("db error: {e}"))
            })?;

    match row {
        Some((granularity,)) => Ok(Json(PreferencesResponse {
            chart_granularity: granularity,
        })),
        None => Ok(Json(PreferencesResponse {
            chart_granularity: DEFAULT_GRANULARITY.to_string(),
        })),
    }
}

pub async fn patch_preferences(
    State(state): State<AppState>,
    session: Session,
    headers: HeaderMap,
    Json(input): Json<PreferencesPatch>,
) -> Result<Json<PreferencesResponse>, (StatusCode, Json<serde_json::Value>)> {
    // CSRF check
    let expected = session.get::<String>(SESSION_CSRF_KEY).await.ok().flatten();
    let provided = extract_csrf_header(&headers);
    match (expected, provided) {
        (Some(e), Some(p)) if constant_time_eq(&e, &p) => {}
        _ => return Err(error_json(StatusCode::FORBIDDEN, "csrf required")),
    }
    if !origin_allowed(&headers, state.config.cors_origin.as_deref()) {
        return Err(error_json(StatusCode::FORBIDDEN, "origin not allowed"));
    }

    // Validate granularity
    if !SUPPORTED_GRANULARITIES.contains(&input.chart_granularity.as_str()) {
        return Err(error_json(
            StatusCode::BAD_REQUEST,
            "unsupported granularity",
        ));
    }

    let user_id: Option<String> = session
        .get(SESSION_USER_KEY)
        .await
        .map_err(|_| error_json(StatusCode::INTERNAL_SERVER_ERROR, "session error"))?;
    let id_str = user_id.ok_or_else(|| error_json(StatusCode::UNAUTHORIZED, "unauthenticated"))?;

    let uid = uuid::Uuid::parse_str(&id_str)
        .map_err(|_| error_json(StatusCode::UNAUTHORIZED, "invalid user"))?;

    // Upsert
    sqlx::query(
        "INSERT INTO user_preferences (user_id, chart_granularity, updated_at) VALUES ($1, $2, NOW()) \
         ON CONFLICT (user_id) DO UPDATE SET chart_granularity = EXCLUDED.chart_granularity, updated_at = NOW()",
    )
    .bind(uid)
    .bind(&input.chart_granularity)
    .execute(&state.db)
    .await
    .map_err(|e: SqlxError| error_json(StatusCode::INTERNAL_SERVER_ERROR, &format!("db error: {e}")))?;

    Ok(Json(PreferencesResponse {
        chart_granularity: input.chart_granularity,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_granularities_include_1dutc() {
        assert!(SUPPORTED_GRANULARITIES.contains(&"1Dutc"));
    }

    #[test]
    fn supported_granularities_include_intraday() {
        assert!(SUPPORTED_GRANULARITIES.contains(&"1m"));
        assert!(SUPPORTED_GRANULARITIES.contains(&"5m"));
        assert!(SUPPORTED_GRANULARITIES.contains(&"15m"));
        assert!(SUPPORTED_GRANULARITIES.contains(&"1H"));
        assert!(SUPPORTED_GRANULARITIES.contains(&"4H"));
    }

    #[test]
    fn standard_1d_is_not_supported_internal_value() {
        assert!(!SUPPORTED_GRANULARITIES.contains(&"1D"));
    }

    #[test]
    fn default_granularity_is_1m() {
        assert_eq!(DEFAULT_GRANULARITY, "1m");
    }
}
