use crate::vault::errors::VaultError;
use std::collections::BTreeMap;

#[derive(Clone)]
pub struct Keyring {
    pub active: u32,
    keys: BTreeMap<u32, [u8; 32]>,
}

impl Keyring {
    pub fn new(active: u32, keys: BTreeMap<u32, [u8; 32]>) -> Result<Self, VaultError> {
        if !keys.contains_key(&active) {
            return Err(VaultError::MissingKeyVersion(active));
        }
        for (v, k) in &keys {
            if k.len() != 32 {
                return Err(VaultError::InvalidKeyConfig);
            }
            let _ = v;
        }
        Ok(Self { active, keys })
    }

    pub fn active_version(&self) -> u32 {
        self.active
    }
    pub fn active_key(&self) -> &[u8; 32] {
        self.keys.get(&self.active).unwrap()
    }

    pub fn get(&self, version: u32) -> Result<&[u8; 32], VaultError> {
        self.keys
            .get(&version)
            .ok_or(VaultError::MissingKeyVersion(version))
    }

    pub fn from_env() -> Result<Self, VaultError> {
        // MASTER_KEY_VERSION=1
        // MASTER_KEY_1=<base64 32 bytes>
        // MASTER_KEY_2=... optional
        let active: u32 = std::env::var("MASTER_KEY_VERSION")
            .ok()
            .and_then(|s| s.parse().ok())
            .ok_or(VaultError::InvalidKeyConfig)?;
        let mut keys = BTreeMap::new();
        for (k, v) in std::env::vars() {
            if let Some(rest) = k.strip_prefix("MASTER_KEY_") {
                if rest == "VERSION" {
                    continue;
                }
                if let Ok(ver) = rest.parse::<u32>() {
                    let bytes = base64_decode(&v)?;
                    if bytes.len() != 32 {
                        return Err(VaultError::InvalidKeyConfig);
                    }
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&bytes);
                    keys.insert(ver, arr);
                }
            }
        }
        Self::new(active, keys)
    }

    pub fn rewrap_dek(
        &self,
        id: &uuid::Uuid,
        exchange: &str,
        old_version: u32,
        wrapped_dek: &[u8],
        wrapped_dek_nonce: &[u8; 24],
        new_version: u32,
    ) -> Result<(Vec<u8>, [u8; 24]), VaultError> {
        use chacha20poly1305::{
            aead::{Aead, KeyInit, Payload},
            XChaCha20Poly1305, XNonce,
        };
        let old_key = self.get(old_version)?;
        let new_key = self.get(new_version)?;
        let aad_wrap = crate::vault::crypto::aad_wrap(id, exchange);
        // unwrap
        let cipher = XChaCha20Poly1305::new(old_key.into());
        let dek = cipher
            .decrypt(
                XNonce::from_slice(wrapped_dek_nonce),
                Payload {
                    msg: wrapped_dek,
                    aad: &aad_wrap,
                },
            )
            .map_err(|_| VaultError::AuthenticationFailed)?;
        // rewrap
        let mut new_nonce = [0u8; 24];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut new_nonce);
        let cipher2 = XChaCha20Poly1305::new(new_key.into());
        let wrapped = cipher2
            .encrypt(
                XNonce::from_slice(&new_nonce),
                Payload {
                    msg: &dek,
                    aad: &aad_wrap,
                },
            )
            .map_err(|_| VaultError::Crypto)?;
        Ok((wrapped, new_nonce))
    }
}

fn base64_decode(s: &str) -> Result<Vec<u8>, VaultError> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|_| VaultError::InvalidKeyConfig)
}
