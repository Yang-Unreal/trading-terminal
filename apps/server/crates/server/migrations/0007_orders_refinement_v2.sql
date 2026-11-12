-- Order schema refinement v2.
--
-- Corrects Bitget Classic V2 field semantics introduced in migration 0006:
--
--   1. Renames margin_mode -> position_mode with corrected values
--      (one_way -> one_way_mode, hedged -> hedge_mode), representing the
--      account-level position mode, NOT Bitget's marginMode parameter.
--   2. Adds margin_mode column (isolated / crossed) for Bitget's marginMode.
--   3. Adds margin_coin column (USDT for USDT-FUTURES).
--   4. Adds trade_side column (open / close / NULL; hedge mode only).
--   5. Adds reduce_only boolean column (one-way mode only).
--   6. Corrects time_in_force values to Bitget's force parameter
--        (gtc / ioc / fok / post_only).
--   7. Makes exchange status nullable (order may be persisted before exchange
--        confirmation).
+
-- Step 1: Drop the old margin_mode constraint
ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_margin_mode_valid;

-- Step 2: Rename margin_mode -> position_mode
ALTER TABLE orders
    RENAME COLUMN margin_mode TO position_mode;

-- Step 3: Remove old default, convert existing values, add position_mode constraint
ALTER TABLE orders
    ALTER COLUMN position_mode DROP DEFAULT;

UPDATE orders
    SET position_mode = 'one_way_mode'
    WHERE position_mode = 'one_way';

UPDATE orders
    SET position_mode = 'hedge_mode'
    WHERE position_mode = 'hedged';

ALTER TABLE orders
    ALTER COLUMN position_mode SET NOT NULL,
    ADD CONSTRAINT orders_position_mode_valid CHECK (position_mode IN ('one_way_mode', 'hedge_mode'));

-- Step 4: Add margin_mode column (Bitget marginMode: isolated / crossed)
-- Nullable: application must explicitly supply the margin mode; no default.
ALTER TABLE orders
    ADD COLUMN margin_mode TEXT,
    ADD CONSTRAINT orders_margin_mode_valid CHECK (margin_mode IN ('isolated', 'crossed'));

-- Step 5: Add margin_coin column (Bitget marginCoin; USDT for USDT-FUTURES)
-- Nullable: application must explicitly supply the margin coin; no default.
ALTER TABLE orders
    ADD COLUMN margin_coin TEXT;

-- Step 6: Add trade_side column (open / close / NULL; hedge mode only)
ALTER TABLE orders
    ADD COLUMN trade_side TEXT,
    ADD CONSTRAINT orders_trade_side_valid CHECK (
        (position_mode = 'one_way_mode' AND trade_side IS NULL)
        OR (position_mode = 'hedge_mode' AND trade_side IN ('open', 'close'))
    );

-- Step 7: Correct time_in_force values to Bitget force parameter (lowercase)
-- Existing v6 values were uppercase (GTC/IOC/FOK/PO); convert to lowercase.
UPDATE orders
    SET time_in_force = 'gtc'
    WHERE time_in_force = 'GTC';

UPDATE orders
    SET time_in_force = 'ioc'
    WHERE time_in_force = 'IOC';

UPDATE orders
    SET time_in_force = 'fok'
    WHERE time_in_force = 'FOK';

UPDATE orders
    SET time_in_force = 'post_only'
    WHERE time_in_force = 'PO';

-- Add constraint
ALTER TABLE orders
    ADD CONSTRAINT orders_time_in_force_valid CHECK (
        time_in_force IS NULL OR time_in_force IN ('gtc', 'ioc', 'fok', 'post_only')
    );

-- Step 8: Add reduce_only column (boolean, default false; one-way mode only)
ALTER TABLE orders
    ADD COLUMN reduce_only BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT orders_reduce_only_valid CHECK (
        NOT reduce_only OR position_mode = 'one_way_mode'
    );

-- Step 9: Make exchange status nullable (order may be persisted before
-- exchange confirmation; NULL means exchange state not yet established)
ALTER TABLE orders
    ALTER COLUMN status DROP NOT NULL;

-- Step 10: Add order_type and price/time_in_force consistency constraints
ALTER TABLE orders
    ADD COLUMN order_type TEXT NOT NULL DEFAULT 'limit',
    ADD CONSTRAINT orders_order_type_valid CHECK (order_type IN ('limit', 'market')),
    ADD CONSTRAINT orders_price_time_in_force_valid CHECK (
        (order_type = 'limit' AND price IS NOT NULL AND time_in_force IS NOT NULL)
        OR (order_type = 'market' AND price IS NULL AND time_in_force IS NULL)
    );

-- Step 10b: Indexes
-- Replace idx_orders_user_id_status_created_at with two indexes:
--   (user_id, created_at DESC)  -> recent orders for a user
--   (user_id, status, created_at DESC)  -> user's orders filtered by status
DROP INDEX IF EXISTS idx_orders_user_id_status_created_at;

CREATE INDEX IF NOT EXISTS idx_orders_user_id_created_at ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_id_status_created_at ON orders (user_id, status, created_at DESC);

-- Keep existing indexes from v6
CREATE INDEX IF NOT EXISTS idx_orders_exchange_order_id ON orders (exchange_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders (symbol);
