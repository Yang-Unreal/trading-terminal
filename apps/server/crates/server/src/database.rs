//! SQLx connection pool and health-check helpers.

#![allow(dead_code)]

use sqlx::{postgres::PgPoolOptions, PgPool};

pub type Database = PgPool;

pub async fn connect() -> Result<Database, Box<dyn std::error::Error + Send + Sync>> {
    let url = std::env::var("DATABASE_URL")?;
    Ok(PgPoolOptions::new().max_connections(5).connect(&url).await?)
}

pub async fn is_healthy(pool: &Database) -> bool {
    pool.acquire().await.is_ok()
}
