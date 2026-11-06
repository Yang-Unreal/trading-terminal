mod auth;
mod config;
mod database;
mod session_store;

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
        // SELECT 1
        let one: i32 = sqlx::query_scalar("SELECT 1").fetch_one(&pool).await.expect("select1");
        assert_eq!(one, 1);
        MIGRATOR.run(&pool).await.expect("migrate");
        let applied: Option<i64> = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .expect("version");
        let latest = MIGRATOR.migrations.last().map(|m| m.version).unwrap_or(0);
        assert_eq!(applied.unwrap_or(0), latest);
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
        let pool = PgPoolOptions::new().max_connections(2).connect(&cfg.database_url).await?;
        let _ = sqlx::query("DELETE FROM tower_sessions.session").execute(&pool).await;
        sqlx::query("DELETE FROM users").execute(&pool).await?;
        println!("All administrators deleted.");
        return Ok(());
    }

    if args.len() >= 2 && args[1] == "create-admin" {
        dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../../.env")).ok();
        let cfg = config::Config::from_env()?;
        let pool = PgPoolOptions::new().max_connections(2).connect(&cfg.database_url).await?;
        // check existing
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users").fetch_one(&pool).await?;
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
        let hash = auth::hash_password(&password).await.map_err(|_| "hash failed")?;
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

    let state = AppState {
        db: pool.clone(),
        config: cfg.clone(),
    };

    let app = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/auth/login", axum::routing::post(auth::login))
        .route("/auth/logout", axum::routing::post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/csrf", get(auth::get_csrf))
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
        let pool = PgPoolOptions::new().max_connections(1).connect(&cfg.database_url).await.unwrap();
        let rows: Vec<(uuid::Uuid,String,String)> = sqlx::query_as("SELECT id, username, password_hash FROM users").fetch_all(&pool).await.unwrap();
        for r in rows { println!("USER: {:?} hashlen={}", r.1, r.2.len()); }
    }
}
