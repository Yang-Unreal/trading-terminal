use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;

use crate::session_store::PostgresStore;
use crate::AppState;

pub const SESSION_USER_KEY: &str = "user_id";
pub const SESSION_CSRF_KEY: &str = "csrf_token";

static RATE_LIMITER: std::sync::LazyLock<Mutex<HashMap<String, (u32, Instant)>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn client_ip(_headers: &HeaderMap) -> String {
    // Only trust direct remote; forwarded headers ignored for safety.
    "unknown".to_string()
}

fn rate_limit_check(key: &str) -> Result<(), u64> {
    let mut map = RATE_LIMITER.lock().unwrap();
    let now = Instant::now();
    let entry = map.entry(key.to_string()).or_insert((0, now));
    if now.duration_since(entry.1) > Duration::from_secs(300) {
        *entry = (0, now);
    }
    if entry.0 >= 5 {
        let retry = 300 - now.duration_since(entry.1).as_secs();
        return Err(retry.max(1));
    }
    Ok(())
}

fn rate_limit_fail(key: &str) {
    let mut map = RATE_LIMITER.lock().unwrap();
    let e = map.entry(key.to_string()).or_insert((0, Instant::now()));
    e.0 += 1;
}

fn rate_limit_reset(key: &str) {
    let mut map = RATE_LIMITER.lock().unwrap();
    map.remove(key);
}

#[derive(Deserialize)]
pub struct LoginInput {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub authenticated: bool,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct UserInfo {
    pub id: uuid::Uuid,
    pub username: String,
}

#[derive(Serialize)]
pub struct CsrfResponse {
    pub csrf_token: String,
}

pub async fn hash_password(password: &str) -> Result<String, StatusCode> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn verify_password(hash: &str, password: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

fn generate_csrf_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

async fn get_or_create_csrf(session: &Session) -> Result<String, StatusCode> {
    if let Ok(Some(tok)) = session.get::<String>(SESSION_CSRF_KEY).await {
        return Ok(tok);
    }
    let tok = generate_csrf_token();
    session
        .insert(SESSION_CSRF_KEY, tok.clone())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(tok)
}

pub fn extract_csrf_header(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

pub fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

pub fn origin_allowed(headers: &HeaderMap, cfg_origin: Option<&str>) -> bool {
    match headers.get("origin").and_then(|v| v.to_str().ok()) {
        None => true,
        Some(o) => cfg_origin.map(|c| o == c).unwrap_or(true),
    }
}

pub async fn get_csrf(
    session: Session,
    State(_state): State<AppState>,
) -> Result<Json<CsrfResponse>, StatusCode> {
    let tok = get_or_create_csrf(&session).await?;
    Ok(Json(CsrfResponse { csrf_token: tok }))
}

pub async fn login(
    State(state): State<AppState>,
    session: Session,
    headers: HeaderMap,
    Json(input): Json<LoginInput>,
) -> Result<Json<AuthResponse>, StatusCode> {
    // Rate limit check
    let key = format!("{}:{}", input.username, client_ip(&headers));
    if let Err(_retry) = rate_limit_check(&key) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    // CSRF check
    let expected = session.get::<String>(SESSION_CSRF_KEY).await.ok().flatten();
    let provided = extract_csrf_header(&headers);
    match (expected, provided) {
        (Some(e), Some(p)) if constant_time_eq(&e, &p) => {}
        _ => return Err(StatusCode::FORBIDDEN),
    }
    if !origin_allowed(&headers, state.config.cors_origin.as_deref()) {
        return Err(StatusCode::FORBIDDEN);
    }

    let row: Option<(uuid::Uuid, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE username = $1")
            .bind(&input.username)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (id, hash) = match row {
        Some(u) => u,
        None => {
            rate_limit_fail(&key);
            return Err(StatusCode::UNAUTHORIZED);
        }
    };

    if !verify_password(&hash, &input.password).await {
        rate_limit_fail(&key);
        return Err(StatusCode::UNAUTHORIZED);
    }

    let _ = session.cycle_id().await;
    // new csrf token
    let new_tok = generate_csrf_token();
    session
        .insert(SESSION_CSRF_KEY, new_tok)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    session
        .insert(SESSION_USER_KEY, id.to_string())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    rate_limit_reset(&key);
    Ok(Json(AuthResponse {
        authenticated: true,
    }))
}

pub async fn logout(session: Session, headers: HeaderMap) -> StatusCode {
    let expected = session.get::<String>(SESSION_CSRF_KEY).await.ok().flatten();
    let provided = extract_csrf_header(&headers);
    match (expected, provided) {
        (Some(e), Some(p)) if constant_time_eq(&e, &p) => {}
        _ => return StatusCode::FORBIDDEN,
    }
    let _ = session.flush().await;
    StatusCode::NO_CONTENT
}

pub async fn me(
    State(state): State<AppState>,
    session: Session,
) -> Result<Json<UserInfo>, StatusCode> {
    let user_id: Option<String> = session
        .get(SESSION_USER_KEY)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let id = user_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let uid = uuid::Uuid::parse_str(&id).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let info = sqlx::query_as::<_, UserInfo>("SELECT id, username FROM users WHERE id = $1")
        .bind(uid)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    info.ok_or(StatusCode::UNAUTHORIZED).map(Json)
}

#[allow(dead_code)]
pub async fn require_auth(session: Session) -> StatusCode {
    match session.get::<String>(SESSION_USER_KEY).await {
        Ok(Some(_)) => StatusCode::OK,
        _ => StatusCode::UNAUTHORIZED,
    }
}

pub async fn session_layer(
    store: PostgresStore,
    is_production: bool,
) -> tower_sessions::SessionManagerLayer<PostgresStore> {
    store.migrate().await.expect("session migrate");
    let layer = tower_sessions::SessionManagerLayer::new(store);
    if is_production {
        layer.with_secure(true).with_http_only(true)
    } else {
        layer.with_secure(false).with_http_only(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn password_hash_and_verify() {
        let hash = hash_password("secret123").await.unwrap();
        assert!(verify_password(&hash, "secret123").await);
        assert!(!verify_password(&hash, "wrong").await);
    }

    #[test]
    fn constant_time_eq_works() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
    }

    #[test]
    fn origin_allowed_logic() {
        let mut h = HeaderMap::new();
        assert!(origin_allowed(&h, Some("http://localhost:5173")));
        h.insert("origin", "http://localhost:5173".parse().unwrap());
        assert!(origin_allowed(&h, Some("http://localhost:5173")));
        h.insert("origin", "http://evil.example".parse().unwrap());
        assert!(!origin_allowed(&h, Some("http://localhost:5173")));
        let mut h2 = HeaderMap::new();
        h2.insert("origin", "http://evil.example".parse().unwrap());
        assert!(origin_allowed(&h2, None));
    }

    #[test]
    fn rate_limit_blocks_after_five() {
        let key = "test-user:127.0.0.1:extra";
        rate_limit_reset(key);
        for _ in 0..5 {
            assert!(rate_limit_check(key).is_ok());
            rate_limit_fail(key);
        }
        assert!(rate_limit_check(key).is_err());
        rate_limit_reset(key);
    }
}
