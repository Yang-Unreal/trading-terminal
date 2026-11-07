use crate::{
    auth::{
        constant_time_eq, extract_csrf_header, origin_allowed, SESSION_CSRF_KEY, SESSION_USER_KEY,
    },
    vault::service::{self, NewCredential},
    AppState,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use tower_sessions::Session;
use uuid::Uuid;

#[derive(serde::Deserialize)]
pub struct CreateReq {
    pub exchange: String,
    pub label: String,
    pub api_key: String,
    pub api_secret: String,
    pub passphrase: String,
}

#[derive(serde::Deserialize)]
pub struct PatchReq {
    pub label: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(serde::Serialize)]
pub struct MetaResp {
    pub id: Uuid,
    pub exchange: String,
    pub label: String,
    pub api_key_hint: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn to_resp(m: service::CredentialMetadata) -> MetaResp {
    MetaResp {
        id: m.id,
        exchange: m.exchange,
        label: m.label,
        api_key_hint: m.api_key_hint,
        is_active: m.is_active,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

async fn authed(session: &Session) -> bool {
    session
        .get::<String>(SESSION_USER_KEY)
        .await
        .ok()
        .flatten()
        .is_some()
}

async fn csrf_ok(session: &Session, headers: &HeaderMap) -> bool {
    let expected = session.get::<String>(SESSION_CSRF_KEY).await.ok().flatten();
    let provided = extract_csrf_header(headers);
    match (expected, provided) {
        (Some(e), Some(p)) if constant_time_eq(&e, &p) => true,
        _ => false,
    }
}

pub async fn create(
    State(state): State<AppState>,
    session: Session,
    headers: HeaderMap,
    Json(input): Json<CreateReq>,
) -> Result<Json<MetaResp>, StatusCode> {
    if !authed(&session).await {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if !csrf_ok(&session, &headers).await {
        return Err(StatusCode::FORBIDDEN);
    }
    if !origin_allowed(&headers, state.config.cors_origin.as_deref()) {
        return Err(StatusCode::FORBIDDEN);
    }
    let nc = NewCredential {
        exchange: input.exchange,
        label: input.label,
        api_key: input.api_key,
        api_secret: input.api_secret,
        passphrase: input.passphrase,
    };
    let m = service::create_credential(&state.db, &state.keyring, nc)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Json(to_resp(m)))
}

pub async fn list(
    State(state): State<AppState>,
    session: Session,
) -> Result<Json<Vec<MetaResp>>, StatusCode> {
    if !authed(&session).await {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let items = service::list_credentials(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(items.into_iter().map(to_resp).collect()))
}

pub async fn get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> Result<Json<MetaResp>, StatusCode> {
    if !authed(&session).await {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let m = service::get_metadata(&state.db, id)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(Json(to_resp(m)))
}

pub async fn patch(
    State(state): State<AppState>,
    session: Session,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<PatchReq>,
) -> Result<Json<MetaResp>, StatusCode> {
    if !authed(&session).await {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if !csrf_ok(&session, &headers).await {
        return Err(StatusCode::FORBIDDEN);
    }
    if !origin_allowed(&headers, state.config.cors_origin.as_deref()) {
        return Err(StatusCode::FORBIDDEN);
    }
    let m = service::update_metadata(&state.db, id, input.label, input.is_active)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Json(to_resp(m)))
}

pub async fn delete(
    State(state): State<AppState>,
    session: Session,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> StatusCode {
    if !authed(&session).await {
        return StatusCode::UNAUTHORIZED;
    }
    if !csrf_ok(&session, &headers).await {
        return StatusCode::FORBIDDEN;
    }
    if !origin_allowed(&headers, state.config.cors_origin.as_deref()) {
        return StatusCode::FORBIDDEN;
    }
    match service::delete_credential(&state.db, id).await {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}
