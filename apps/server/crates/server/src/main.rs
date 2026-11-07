mod auth;
mod config;
mod database;
mod market;
mod session_store;
mod vault;

use axum::{routing::get, Json, Router};
use serde::Serialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tower_http::cors::CorsLayer;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: config::Config,
    pub keyring: vault::Keyring,
    pub market: market::MarketService,
    pub market_engine: std::sync::Arc<market::MarketDataEngine>,
}

#[derive(Serialize)]
struct LiveResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct ReadyResponse {
    status: &'static str,
    schema_version: i64,
}

async fn live() -> Json<LiveResponse> {
    Json(LiveResponse { status: "ok" })
}

async fn ready(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<ReadyResponse>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    // DB connectivity
    if state.db.acquire().await.is_err() {
        return Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"status":"not_ready","reason":"database_unavailable"})),
        ));
    }
    // migration version
    let applied: Option<i64> = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
        .fetch_one(&state.db)
        .await
        .unwrap_or(None);
    let latest = MIGRATOR.migrations.last().map(|m| m.version).unwrap_or(0);
    let ver = applied.unwrap_or(0);
    if ver < latest {
        return Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(
                serde_json::json!({"status":"not_ready","reason":"migrations_incomplete","schema_version":ver}),
            ),
        ));
    }
    Ok(Json(ReadyResponse {
        status: "ok",
        schema_version: ver,
    }))
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn test_db_url() -> String {
        std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL")
    }

    async fn setup_pool() -> PgPool {
        dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../../.env")).ok();
        let key = [7u8; 32];
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(key);
        std::env::set_var("MASTER_KEY_VERSION", "1");
        std::env::set_var("MASTER_KEY_1", &b64);
        let url = test_db_url();
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect");
        MIGRATOR.run(&pool).await.expect("migrate");
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await
            .unwrap();
        if count == 0 {
            let hash = auth::hash_password("testpass").await.unwrap();
            sqlx::query("INSERT INTO users (username, password_hash) VALUES ($1,$2)")
                .bind("testadmin")
                .bind(&hash)
                .execute(&pool)
                .await
                .unwrap();
        }
        pool
    }

    async fn build_app(pool: PgPool, cfg: config::Config) -> axum::Router {
        let keyring = vault::Keyring::from_env().unwrap();
        let market = market::MarketService::new().unwrap();
        let engine =
            std::sync::Arc::new(market::MarketDataEngine::new(vec!["BTCUSDT".to_string()]));
        let state = AppState {
            db: pool.clone(),
            config: cfg.clone(),
            keyring,
            market,
            market_engine: engine,
        };
        let store = crate::session_store::PostgresStore::new(pool.clone());
        let app = Router::new()
            .route("/health/live", get(live))
            .route("/auth/login", axum::routing::post(auth::login))
            .route("/auth/logout", axum::routing::post(auth::logout))
            .route("/auth/me", get(auth::me))
            .route("/auth/csrf", get(auth::get_csrf))
            .route("/protected", get(auth::require_auth))
            .route(
                "/api/credentials",
                get(vault::api::list).post(vault::api::create),
            )
            .layer(cors_layer(&cfg))
            .with_state(state);
        app.layer(auth::session_layer(store, false).await)
    }

    fn extract_cookie(res: &axum::http::Response<Body>) -> Option<String> {
        res.headers()
            .get("set-cookie")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.split(';').next().unwrap().to_string())
    }

    #[tokio::test]
    async fn protected_requires_auth() {
        let pool = setup_pool().await;
        let mut cfg = config::Config::from_env().unwrap();
        cfg.database_url = test_db_url();
        if cfg.cors_origin.is_none() {
            cfg.cors_origin = Some("http://localhost:5173".to_string());
        }
        let app = build_app(pool, cfg).await;
        let req = Request::builder()
            .uri("/protected")
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn login_and_me() {
        let pool = setup_pool().await;
        let mut cfg = config::Config::from_env().unwrap();
        cfg.database_url = test_db_url();
        if cfg.cors_origin.is_none() {
            cfg.cors_origin = Some("http://localhost:5173".to_string());
        }
        let app = build_app(pool, cfg).await;
        let req = Request::builder()
            .uri("/auth/csrf")
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        let cookie = extract_cookie(&res).unwrap();
        let body = axum::body::to_bytes(res.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let csrf = v["csrf_token"].as_str().unwrap().to_string();
        let login_body = serde_json::json!({"username":"testadmin","password":"testpass"});
        let req = Request::builder()
            .method("POST")
            .uri("/auth/login")
            .header("content-type", "application/json")
            .header("x-csrf-token", &csrf)
            .header("cookie", &cookie)
            .header("origin", "http://localhost:5173")
            .body(Body::from(login_body.to_string()))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let auth_cookie = extract_cookie(&res).unwrap_or(cookie.clone());
        let req = Request::builder()
            .uri("/auth/me")
            .header("cookie", &auth_cookie)
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }
}
fn cors_layer(cfg: &config::Config) -> CorsLayer {
    match &cfg.cors_origin {
        Some(origin) => CorsLayer::new()
            .allow_origin(
                origin
                    .parse::<axum::http::HeaderValue>()
                    .expect("invalid CORS_ORIGIN"),
            )
            .allow_methods([
                axum::http::Method::GET,
                axum::http::Method::POST,
                axum::http::Method::PUT,
                axum::http::Method::DELETE,
            ])
            .allow_headers([
                axum::http::HeaderName::from_static("content-type"),
                axum::http::HeaderName::from_static("x-csrf-token"),
            ])
            .allow_credentials(true),
        None => CorsLayer::permissive(),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // CLI: create-admin
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 2 && args[1] == "delete-admin" {
        dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../../.env")).ok();
        let cfg = config::Config::from_env()?;
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&cfg.database_url)
            .await?;
        let _ = sqlx::query("DELETE FROM tower_sessions.session")
            .execute(&pool)
            .await;
        sqlx::query("DELETE FROM users").execute(&pool).await?;
        println!("All administrators deleted.");
        return Ok(());
    }

    if args.len() >= 2 && args[1] == "create-admin" {
        dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../../.env")).ok();
        let cfg = config::Config::from_env()?;
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&cfg.database_url)
            .await?;
        // check existing
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await?;
        if count > 0 {
            eprintln!("Administrator already exists. Aborting.");
            return Ok(());
        }
        use std::io::{self, Write};
        print!("Username: ");
        io::stdout().flush().unwrap();
        let mut username = String::new();
        io::stdin().read_line(&mut username)?;
        let username = username.trim().to_string();
        let password = rpassword::prompt_password("Password: ").unwrap();
        let confirm = rpassword::prompt_password("Confirm password: ").unwrap();
        if password != confirm {
            eprintln!("Passwords do not match.");
            return Ok(());
        }
        let hash = auth::hash_password(&password)
            .await
            .map_err(|_| "hash failed")?;
        sqlx::query("INSERT INTO users (username, password_hash) VALUES ($1, $2)")
            .bind(&username)
            .bind(&hash)
            .execute(&pool)
            .await?;
        println!("Administrator created.");
        return Ok(());
    }

    dotenvy::dotenv().ok();

    let cfg = config::Config::from_env().map_err(|e| {
        eprintln!("Configuration error: {}", e);
        std::io::Error::other(e)
    })?;

    println!("Connecting to database...");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&cfg.database_url)
        .await?;
    println!("Database connected successfully");

    MIGRATOR.run(&pool).await?;
    println!("Migrations applied");

    let keyring = vault::Keyring::from_env().map_err(|e| {
        eprintln!("Keyring error: {}", e);
        std::io::Error::other(e.to_string())
    })?;

    let market = market::MarketService::new().map_err(|e| {
        eprintln!("Market error: {}", e);
        std::io::Error::other(e.to_string())
    })?;

    let ws_url = cfg.bitget_ws_url();
    let ws_proxy = cfg.effective_bitget_ws_proxy();
    let market_engine = std::sync::Arc::new(market::MarketDataEngine::new_with_url_and_proxy(
        vec!["BTCUSDT".to_string()],
        ws_url,
        ws_proxy,
    ));
    market_engine.clone().start();

    let state = AppState {
        db: pool.clone(),
        config: cfg.clone(),
        keyring,
        market,
        market_engine,
    };

    let app = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/auth/login", axum::routing::post(auth::login))
        .route("/auth/logout", axum::routing::post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/csrf", get(auth::get_csrf))
        .route(
            "/api/credentials",
            get(vault::api::list).post(vault::api::create),
        )
        .route(
            "/api/credentials/{id}",
            get(vault::api::get)
                .patch(vault::api::patch)
                .delete(vault::api::delete),
        )
        .route(
            "/api/market/instruments/{symbol}",
            get(market::api::instrument),
        )
        .route("/api/market/ticker/{symbol}", get(market::api::ticker))
        .route(
            "/api/market/orderbook/{symbol}",
            get(market::api::orderbook),
        )
        .route("/ws/market", get(market::ws::ws_market))
        .layer(cors_layer(&cfg))
        .with_state(state);

    let store = crate::session_store::PostgresStore::new(pool.clone());
    let app = app.layer(auth::session_layer(store, cfg.is_production()).await);

    let addr = cfg.addr();
    println!("Starting HTTP server at http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

#[cfg(test)]
mod dbg {
    use super::*;
    #[tokio::test]
    async fn show() {
        dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../../.env")).ok();
        let cfg = config::Config::from_env().unwrap();
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&cfg.database_url)
            .await
            .unwrap();
        let rows: Vec<(uuid::Uuid, String, String)> =
            sqlx::query_as("SELECT id, username, password_hash FROM users")
                .fetch_all(&pool)
                .await
                .unwrap();
        for r in rows {
            println!("USER: {:?} hashlen={}", r.1, r.2.len());
        }
    }
}

#[cfg(test)]
mod db_tests {
    use super::*;
    #[tokio::test]
    async fn db_connectivity_and_migrations() {
        dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../../.env")).ok();
        let cfg = config::Config::from_env().expect("config");
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&cfg.database_url)
            .await
            .expect("connect");
        let one: i32 = sqlx::query_scalar("SELECT 1")
            .fetch_one(&pool)
            .await
            .expect("select1");
        assert_eq!(one, 1);
        MIGRATOR.run(&pool).await.expect("migrate");
    }
}
