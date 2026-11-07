pub use self::postgres_store::PostgresStore;
mod postgres_store;

/// An error type for SQLx stores.
#[derive(thiserror::Error, Debug)]
pub enum SqlxStoreError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Encode(#[from] rmp_serde::encode::Error),
    #[error(transparent)]
    Decode(#[from] rmp_serde::decode::Error),
}

impl From<SqlxStoreError> for tower_sessions::session_store::Error {
    fn from(err: SqlxStoreError) -> Self {
        match err {
            SqlxStoreError::Sqlx(inner) => {
                tower_sessions::session_store::Error::Backend(inner.to_string())
            }
            SqlxStoreError::Decode(inner) => {
                tower_sessions::session_store::Error::Decode(inner.to_string())
            }
            SqlxStoreError::Encode(inner) => {
                tower_sessions::session_store::Error::Encode(inner.to_string())
            }
        }
    }
}
