//! In-memory session middleware for Tower/Axum applications.

#![allow(dead_code)]

use tower_sessions::{MemoryStore, SessionManagerLayer};

pub fn session_layer() -> SessionManagerLayer<MemoryStore> {
    SessionManagerLayer::new(MemoryStore::default()).with_secure(false)
}
