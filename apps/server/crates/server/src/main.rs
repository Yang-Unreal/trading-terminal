mod database;
use axum::{routing::get, Json, Router};
use serde::Serialize;
use tower_http::cors::CorsLayer;
mod auth;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    message: &'static str,
    database: &'static str,
}

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
}

async fn health(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<HealthResponse> {
    let db_status = if state.db.acquire().await.is_ok() {
        "connected"
    } else {
        "disconnected"
    };
    Json(HealthResponse {
        status: "ok",
        message: "Server is running",
        database: db_status,
    })
}

/// CORS pinned to `CORS_ORIGIN` when set, permissive otherwise.
fn cors_layer() -> CorsLayer {
    match std::env::var("CORS_ORIGIN") {
        Ok(origin) if !origin.is_empty() => CorsLayer::new()
            .allow_origin(origin.parse::<axum::http::HeaderValue>().expect("invalid CORS_ORIGIN"))
            .allow_methods(tower_http::cors::Any)
            .allow_headers(tower_http::cors::Any),
        _ => CorsLayer::permissive(),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load environment variables
    dotenvy::dotenv().ok();




    // Initialize database connection pool
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    println!("Connecting to database...");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;
    println!("Database connected successfully");

    let state = AppState { db: pool.clone() };

    // Build router with state
    let app = Router::new()
        .route("/health", get(health))
        .layer(cors_layer())
        .with_state(state);

    // Attach cookie-backed session management to every Axum route.
    let app = app.layer(auth::session_layer());

    // Get host and port from environment
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("{}:{}", host, port);

    println!("Starting HTTP server at http://{}", addr);

    // Start server
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
