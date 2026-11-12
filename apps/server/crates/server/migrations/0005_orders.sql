-- Orders submitted through the trading terminal.
--
-- Each row represents a single order placed against the Bitget Classic V2
-- REST API. Orders are owned by a user and may be linked to the API
-- credential used to submit them. Orders are append-only financial records:
-- they are never deleted when a user or credential is removed.

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    credential_id UUID REFERENCES api_credentials(id) ON DELETE SET NULL,
    exchange TEXT NOT NULL,
    product_type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    order_type TEXT NOT NULL,
    price NUMERIC,
    size NUMERIC NOT NULL,
    client_oid TEXT NOT NULL,
    exchange_order_id TEXT,
    status TEXT NOT NULL,
    exchange_status TEXT,
    filled_size NUMERIC NOT NULL DEFAULT '0',
    average_fill_price NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT orders_size_positive CHECK (size > 0),
    CONSTRAINT orders_price_positive CHECK (price IS NULL OR price > 0),
    CONSTRAINT orders_filled_size_nonnegative CHECK (filled_size >= 0),
    CONSTRAINT orders_filled_size_not_exceed_size CHECK (filled_size <= size),
    CONSTRAINT orders_average_fill_price_positive CHECK (average_fill_price IS NULL OR average_fill_price > 0),
    CONSTRAINT orders_side_valid CHECK (side IN ('buy', 'sell')),
    CONSTRAINT orders_status_valid CHECK (
        status IN (
            'pending',
            'open',
            'partially_filled',
            'filled',
            'canceling',
            'canceled',
            'rejected'
        )
    ),
    CONSTRAINT orders_user_client_oid_unique UNIQUE (user_id, client_oid),
    CONSTRAINT orders_user_exchange_order_id_unique UNIQUE (user_id, exchange_order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id_status ON orders (user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders (symbol);
