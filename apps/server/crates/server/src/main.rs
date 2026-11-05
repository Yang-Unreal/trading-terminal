mod database;
use axum::{extract::Path, routing::{delete, get, post, put}, Json, Router};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;
mod auth;
use sqlx::{postgres::PgPoolOptions, PgPool};

#[derive(Serialize, Deserialize, sqlx::FromRow, Clone)]
struct Item {
    id: i64,
    name: String,
}

#[derive(Deserialize)]
struct ItemInput {
    name: String,
}

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
}

async fn health(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<serde_json::Value> {
    let db_status = if state.db.acquire().await.is_ok() {
        "connected"
    } else {
        "disconnected"
    };
    Json(serde_json::json!({"status":"ok","database":db_status}))
}

async fn list_items(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<Vec<Item>>, (axum::http::StatusCode, String)> {
    let items = sqlx::query_as::<_, Item>("SELECT id, name FROM items ORDER BY id")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(items))
}

async fn create_item(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(input): Json<ItemInput>,
) -> Result<Json<Item>, (axum::http::StatusCode, String)> {
    let item = sqlx::query_as::<_, Item>(
        "INSERT INTO items (name) VALUES ($1) RETURNING id, name",
    )
    .bind(input.name)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(item))
}

async fn update_item(
    axum::extract::State(state): axum::extract::State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<ItemInput>,
) -> Result<Json<Option<Item>>, (axum::http::StatusCode, String)> {
    let item = sqlx::query_as::<_, Item>(
        "UPDATE items SET name = $1 WHERE id = $2 RETURNING id, name",
    )
    .bind(input.name)
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(item))
}

async fn delete_item(
    axum::extract::State(state): axum::extract::State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<bool>, (axum::http::StatusCode, String)> {
    let res = sqlx::query("DELETE FROM items WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(res.rows_affected() > 0))
}

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
    dotenvy::dotenv().ok();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    println!("Connecting to database...");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;
    println!("Database connected successfully");

    sqlx::query("CREATE TABLE IF NOT EXISTS items (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL)")
        .execute(&pool)
        .await?;

    let state = AppState { db: pool };

    let app = Router::new()
        .route("/health", get(health))
        .route("/items", get(list_items).post(create_item))
        .route("/items/{id}", put(update_item).delete(delete_item))
        .layer(cors_layer())
        .with_state(state);

    let app = app.layer(auth::session_layer());

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("{}:{}", host, port);

    println!("Starting HTTP server at http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
