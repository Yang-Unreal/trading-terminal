use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

#[derive(Clone, Serialize, Deserialize, Zeroize)]
#[zeroize(drop)]
pub struct BitgetCredentials {
    pub api_key: String,
    pub api_secret: String,
    pub passphrase: String,
}

impl std::fmt::Debug for BitgetCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BitgetCredentials")
            .field("api_key", &"[REDACTED]")
            .field("api_secret", &"[REDACTED]")
            .field("passphrase", &"[REDACTED]")
            .finish()
    }
}
