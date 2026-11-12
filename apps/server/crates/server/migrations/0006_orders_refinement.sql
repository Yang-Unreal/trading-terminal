-- Order schema refinement.
--
-- Adds submission state tracking, margin mode, and time-in-force to the
-- orders table.
--
-- submission_status tracks the local acceptance state of an order
-- submission (pending, submitting, confirmed, failed, unknown). It is
-- distinct from status, which tracks the exchange-reported state of the
-- order (open, partially_filled, filled, canceling, canceled, rejected).
-- A submission may be 'confirmed' while status is still 'open' (the order
-- was accepted by the exchange but not yet filled), or 'unknown' if a
-- network timeout prevents determining whether the exchange received the
-- order. A timeout must never be interpreted as a definite rejection.

-- Add new columns
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS margin_mode TEXT NOT NULL DEFAULT 'one_way',
    ADD COLUMN IF NOT EXISTS time_in_force TEXT,
    ADD COLUMN IF NOT EXISTS submission_status TEXT NOT NULL DEFAULT 'pending';

-- Add check constraints
ALTER TABLE orders
    ADD CONSTRAINT orders_margin_mode_valid CHECK (margin_mode IN ('one_way', 'hedged')),
    ADD CONSTRAINT orders_time_in_force_valid CHECK (time_in_force IS NULL OR time_in_force IN ('GTC', 'IOC', 'FOK', 'PO')),
    ADD CONSTRAINT orders_client_oid_nonempty CHECK (client_oid <> '');

-- Replace indexes: same-column indexes from 0005 are superseded by the
-- composite index below, which supports both "user's recent orders" and
-- "user's orders by status" queries.
DROP INDEX IF EXISTS idx_orders_user_id;
DROP INDEX IF EXISTS idx_orders_user_id_status;
DROP INDEX IF EXISTS idx_orders_symbol;

CREATE INDEX IF NOT EXISTS idx_orders_user_id_status_created_at ON orders (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_exchange_order_id ON orders (exchange_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders (symbol);
