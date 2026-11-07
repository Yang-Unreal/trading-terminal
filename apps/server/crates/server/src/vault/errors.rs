use thiserror::Error;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("missing key version {0}")]
    MissingKeyVersion(u32),
    #[error("invalid key configuration")]
    InvalidKeyConfig,
    #[error("authentication/tag verification failed")]
    AuthenticationFailed,
    #[error("invalid ciphertext format")]
    InvalidCiphertext,
    #[error("unsupported format version {0}")]
    UnsupportedFormatVersion(u32),
    #[error("crypto error")]
    Crypto,
    #[error("serialization error")]
    Serialization,
}
