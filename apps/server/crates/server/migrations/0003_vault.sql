-- Credential Vault schema additions

ALTER TABLE api_credentials
    ADD COLUMN IF NOT EXISTS wrapped_dek BYTEA,
    ADD COLUMN IF NOT EXISTS wrapped_dek_nonce BYTEA,
    ADD COLUMN IF NOT EXISTS encryption_format_version INTEGER NOT NULL DEFAULT 1;

-- Backfill placeholders for existing rows (none expected in dev); keep NOT NULL by defaulting.
UPDATE api_credentials SET wrapped_dek = COALESCE(wrapped_dek, ''::bytea),
                          wrapped_dek_nonce = COALESCE(wrapped_dek_nonce, ''::bytea)
WHERE wrapped_dek IS NULL OR wrapped_dek_nonce IS NULL;
