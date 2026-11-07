use crate::vault::{
    decrypt_credentials, encrypt_credentials, BitgetCredentials, EncryptedRecord, Keyring,
    VaultError,
};
use sqlx::PgPool;
use uuid::Uuid;

pub struct CredentialMetadata {
    pub id: Uuid,
    pub exchange: String,
    pub label: String,
    pub api_key_hint: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone)]
pub struct NewCredential {
    pub exchange: String,
    pub label: String,
    pub api_key: String,
    pub api_secret: String,
    pub passphrase: String,
}

pub async fn create_credential(
    pool: &PgPool,
    keyring: &Keyring,
    input: NewCredential,
) -> Result<CredentialMetadata, VaultError> {
    if input.exchange != "bitget" {
        return Err(VaultError::InvalidKeyConfig);
    }
    if input.label.trim().is_empty() || input.label.len() > 128 {
        return Err(VaultError::InvalidKeyConfig);
    }
    if input.api_key.is_empty() || input.api_secret.is_empty() || input.passphrase.is_empty() {
        return Err(VaultError::InvalidKeyConfig);
    }

    let id = Uuid::new_v4();
    let hint = if input.api_key.len() >= 4 {
        Some(input.api_key[input.api_key.len() - 4..].to_string())
    } else {
        None
    };
    let creds = BitgetCredentials {
        api_key: input.api_key,
        api_secret: input.api_secret,
        passphrase: input.passphrase,
    };
    let active = keyring.active_version();
    let master = keyring.active_key();
    let rec = encrypt_credentials(&creds, &id, &input.exchange, master, active)?;

    sqlx::query(
        "INSERT INTO api_credentials (id, exchange, label, api_key_hint, encrypted_payload, nonce, wrapped_dek, wrapped_dek_nonce, encryption_key_version, encryption_format_version, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)"
    )
    .bind(id)
    .bind(&input.exchange)
    .bind(&input.label)
    .bind(&hint)
    .bind(&rec.ciphertext)
    .bind(&rec.nonce.to_vec())
    .bind(&rec.wrapped_dek)
    .bind(&rec.wrapped_dek_nonce.to_vec())
    .bind(active.to_string())
    .bind(rec.format_version as i32)
    .execute(pool).await.map_err(|_| VaultError::Crypto)?;

    get_metadata(pool, id).await
}

pub async fn get_metadata(pool: &PgPool, id: Uuid) -> Result<CredentialMetadata, VaultError> {
    let row: Option<(Uuid, String, String, Option<String>, bool, String, String)> =
        sqlx::query_as(
            "SELECT id, exchange, label, api_key_hint, is_active, created_at::text, updated_at::text FROM api_credentials WHERE id=$1"
        )
        .bind(id)
        .fetch_optional(pool).await.map_err(|_| VaultError::Crypto)?;
    let r = row.ok_or(VaultError::InvalidCiphertext)?;
    Ok(CredentialMetadata {
        id: r.0,
        exchange: r.1,
        label: r.2,
        api_key_hint: r.3,
        is_active: r.4,
        created_at: r.5,
        updated_at: r.6,
    })
}

pub async fn list_credentials(pool: &PgPool) -> Result<Vec<CredentialMetadata>, VaultError> {
    let rows: Vec<(Uuid, String, String, Option<String>, bool, String, String)> =
        sqlx::query_as(
            "SELECT id, exchange, label, api_key_hint, is_active, created_at::text, updated_at::text FROM api_credentials ORDER BY created_at DESC"
        )
        .fetch_all(pool).await.map_err(|_| VaultError::Crypto)?;
    Ok(rows
        .into_iter()
        .map(|r| CredentialMetadata {
            id: r.0,
            exchange: r.1,
            label: r.2,
            api_key_hint: r.3,
            is_active: r.4,
            created_at: r.5,
            updated_at: r.6,
        })
        .collect())
}

pub async fn update_metadata(
    pool: &PgPool,
    id: Uuid,
    label: Option<String>,
    is_active: Option<bool>,
) -> Result<CredentialMetadata, VaultError> {
    if let Some(l) = &label {
        if l.trim().is_empty() || l.len() > 128 {
            return Err(VaultError::InvalidKeyConfig);
        }
    }
    sqlx::query("UPDATE api_credentials SET label=COALESCE($2,label), is_active=COALESCE($3,is_active), updated_at=NOW() WHERE id=$1")
        .bind(id)
        .bind(label)
        .bind(is_active)
        .execute(pool).await.map_err(|_| VaultError::Crypto)?;
    get_metadata(pool, id).await
}

pub async fn delete_credential(pool: &PgPool, id: Uuid) -> Result<(), VaultError> {
    let res = sqlx::query("DELETE FROM api_credentials WHERE id=$1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|_| VaultError::Crypto)?;
    if res.rows_affected() == 0 {
        return Err(VaultError::InvalidCiphertext);
    }
    Ok(())
}

#[allow(dead_code)]
pub async fn load_credentials(
    pool: &PgPool,
    keyring: &Keyring,
    id: Uuid,
) -> Result<BitgetCredentials, VaultError> {
    let row: Option<(Uuid, String, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, i32, i32)> =
        sqlx::query_as(
            "SELECT id, exchange, encrypted_payload, nonce, wrapped_dek, wrapped_dek_nonce, encryption_key_version, encryption_format_version FROM api_credentials WHERE id=$1"
        )
        .bind(id)
        .fetch_optional(pool).await.map_err(|_| VaultError::Crypto)?;
    let r = row.ok_or(VaultError::InvalidCiphertext)?;
    let key_ver: u32 =
        r.6.to_string()
            .parse()
            .map_err(|_| VaultError::InvalidKeyConfig)?;
    let master = keyring.get(key_ver)?;
    let mut nonce = [0u8; 24];
    nonce.copy_from_slice(&r.3);
    let mut wnonce = [0u8; 24];
    wnonce.copy_from_slice(&r.5);
    let rec = EncryptedRecord {
        ciphertext: r.2,
        nonce,
        wrapped_dek: r.4,
        wrapped_dek_nonce: wnonce,
        key_version: key_ver,
        format_version: r.7 as u32,
    };
    decrypt_credentials(&rec, &r.0, &r.1, master)
}
