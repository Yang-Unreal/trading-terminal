-- User preferences (scoped to authenticated user)
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chart_granularity TEXT NOT NULL DEFAULT '1m',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences (user_id);
