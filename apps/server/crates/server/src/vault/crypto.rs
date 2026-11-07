use crate::vault::{errors::VaultError, types::BitgetCredentials};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;

pub const FORMAT_VERSION: u32 = 1;
const NONCE_LEN: usize = 24;

#[derive(Clone)]
pub struct EncryptedRecord {
    pub ciphertext: Vec<u8>,
    pub nonce: [u8; NONCE_LEN],
    pub wrapped_dek: Vec<u8>,
    pub wrapped_dek_nonce: [u8; NONCE_LEN],
    #[allow(dead_code)]
    pub key_version: u32,
    pub format_version: u32,
}

pub fn generate_dek() -> [u8; 32] {
    let mut dek = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut dek);
    dek
}

pub fn generate_nonce() -> [u8; NONCE_LEN] {
    let mut n = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut n);
    n
}

pub fn aad_payload(id: &uuid::Uuid, exchange: &str) -> Vec<u8> {
    format!("credential:{}:{}:payload:v{}", id, exchange, FORMAT_VERSION).into_bytes()
}

pub fn aad_wrap(id: &uuid::Uuid, exchange: &str) -> Vec<u8> {
    format!("credential:{}:{}:dek:v{}", id, exchange, FORMAT_VERSION).into_bytes()
}

pub fn encrypt_credentials(
    creds: &BitgetCredentials,
    id: &uuid::Uuid,
    exchange: &str,
    master_key: &[u8; 32],
    key_version: u32,
) -> Result<EncryptedRecord, VaultError> {
    let dek = generate_dek();
    let payload_nonce = generate_nonce();
    let wrap_nonce = generate_nonce();

    let cipher = XChaCha20Poly1305::new(&dek.into());
    let plaintext = serde_json::to_vec(creds).map_err(|_| VaultError::Serialization)?;
    let aad = aad_payload(id, exchange);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&payload_nonce),
            Payload {
                msg: &plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| VaultError::Crypto)?;

    let wrap_cipher = XChaCha20Poly1305::new(master_key.into());
    let wrap_aad = aad_wrap(id, exchange);
    let wrapped_dek = wrap_cipher
        .encrypt(
            XNonce::from_slice(&wrap_nonce),
            Payload {
                msg: &dek,
                aad: &wrap_aad,
            },
        )
        .map_err(|_| VaultError::Crypto)?;

    Ok(EncryptedRecord {
        ciphertext,
        nonce: payload_nonce,
        wrapped_dek,
        wrapped_dek_nonce: wrap_nonce,
        key_version,
        format_version: FORMAT_VERSION,
    })
}

#[allow(dead_code)]
pub fn decrypt_credentials(
    rec: &EncryptedRecord,
    id: &uuid::Uuid,
    exchange: &str,
    master_key: &[u8; 32],
) -> Result<BitgetCredentials, VaultError> {
    if rec.format_version != FORMAT_VERSION {
        return Err(VaultError::UnsupportedFormatVersion(rec.format_version));
    }
    let wrap_cipher = XChaCha20Poly1305::new(master_key.into());
    let wrap_aad = aad_wrap(id, exchange);
    let dek_bytes = wrap_cipher
        .decrypt(
            XNonce::from_slice(&rec.wrapped_dek_nonce),
            Payload {
                msg: &rec.wrapped_dek,
                aad: &wrap_aad,
            },
        )
        .map_err(|_| VaultError::AuthenticationFailed)?;
    if dek_bytes.len() != 32 {
        return Err(VaultError::InvalidCiphertext);
    }
    let mut dek = [0u8; 32];
    dek.copy_from_slice(&dek_bytes);
    let cipher = XChaCha20Poly1305::new(&dek.into());
    let aad = aad_payload(id, exchange);
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&rec.nonce),
            Payload {
                msg: &rec.ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| VaultError::AuthenticationFailed)?;
    let creds: BitgetCredentials =
        serde_json::from_slice(&plaintext).map_err(|_| VaultError::Serialization)?;
    Ok(creds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::types::BitgetCredentials;
    use crate::vault::Keyring;

    fn key() -> [u8; 32] {
        [7u8; 32]
    }
    fn creds() -> BitgetCredentials {
        BitgetCredentials {
            api_key: "key123".into(),
            api_secret: "secret".into(),
            passphrase: "pass".into(),
        }
    }

    #[test]
    fn roundtrip() {
        let id = uuid::Uuid::new_v4();
        let rec = encrypt_credentials(&creds(), &id, "bitget", &key(), 1).unwrap();
        assert_ne!(rec.ciphertext, serde_json::to_vec(&creds()).unwrap());
        let dec = decrypt_credentials(&rec, &id, "bitget", &key()).unwrap();
        assert_eq!(dec.api_key, "key123");
    }

    #[test]
    fn tampered_ciphertext_rejected() {
        let id = uuid::Uuid::new_v4();
        let mut rec = encrypt_credentials(&creds(), &id, "bitget", &key(), 1).unwrap();
        rec.ciphertext[0] ^= 1;
        assert!(decrypt_credentials(&rec, &id, "bitget", &key()).is_err());
    }

    #[test]
    fn tampered_nonce_rejected() {
        let id = uuid::Uuid::new_v4();
        let mut rec = encrypt_credentials(&creds(), &id, "bitget", &key(), 1).unwrap();
        rec.nonce[0] ^= 1;
        assert!(decrypt_credentials(&rec, &id, "bitget", &key()).is_err());
    }

    #[test]
    fn wrong_key_rejected() {
        let id = uuid::Uuid::new_v4();
        let rec = encrypt_credentials(&creds(), &id, "bitget", &key(), 1).unwrap();
        let other = [9u8; 32];
        assert!(decrypt_credentials(&rec, &id, "bitget", &other).is_err());
    }

    #[test]
    fn wrong_aad_rejected() {
        let id = uuid::Uuid::new_v4();
        let rec = encrypt_credentials(&creds(), &id, "bitget", &key(), 1).unwrap();
        let other_id = uuid::Uuid::new_v4();
        assert!(decrypt_credentials(&rec, &other_id, "bitget", &key()).is_err());
    }

    #[test]
    fn missing_key_version() {
        let kr = Keyring::new(1, std::collections::BTreeMap::new());
        assert!(kr.is_err());
    }

    #[test]
    fn different_records_differ() {
        let id1 = uuid::Uuid::new_v4();
        let id2 = uuid::Uuid::new_v4();
        let r1 = encrypt_credentials(&creds(), &id1, "bitget", &key(), 1).unwrap();
        let r2 = encrypt_credentials(&creds(), &id2, "bitget", &key(), 1).unwrap();
        assert_ne!(r1.nonce, r2.nonce);
        assert_ne!(r1.wrapped_dek, r2.wrapped_dek);
    }

    #[test]
    fn rewrap_works() {
        let id = uuid::Uuid::new_v4();
        let old_key = [7u8; 32];
        let new_key = [9u8; 32];
        let mut keys = std::collections::BTreeMap::new();
        keys.insert(1, old_key);
        keys.insert(2, new_key);
        let kr = Keyring::new(1, keys).unwrap();
        let rec = encrypt_credentials(&creds(), &id, "bitget", &old_key, 1).unwrap();
        let (new_wrapped, new_nonce) = kr
            .rewrap_dek(
                &id,
                "bitget",
                1,
                &rec.wrapped_dek,
                &rec.wrapped_dek_nonce,
                2,
            )
            .unwrap();
        // build new record
        let mut rec2 = rec.clone();
        rec2.wrapped_dek = new_wrapped;
        rec2.wrapped_dek_nonce = new_nonce;
        rec2.key_version = 2;
        // decrypt with new key should work
        let dec = decrypt_credentials(&rec2, &id, "bitget", &new_key).unwrap();
        assert_eq!(dec.api_key, "key123");
    }
}
