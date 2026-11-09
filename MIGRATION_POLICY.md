# Migration Policy

This document defines the permanent rules for SQLx database migrations in this project.

## Immutable Migration Rules

### Rule 1 — Never Edit an Applied Migration

Once a migration has been applied to any database (development, staging, production, or another developer's local database), its SQL file must never be edited.

This applies to:
- Development databases
- Staging databases
- Production databases
- Other developers' local databases if their state is retained

### Rule 2 — Every Schema Change Uses a New Migration

Every future schema change must use a new migration file with a version number higher than the current latest migration.

The current latest migration is `0004_user_preferences.sql`. The next migration must use `0005_descriptive_name.sql`.

Never reuse an existing version number.

### Rule 3 — Do Not Fix Schema Changes by Editing Historical Migrations

If a migration requires a correction:
1. Restore the canonical original migration file from Git.
2. Create a new forward migration to correct the schema.
3. Verify the actual database structure before constructing the corrective migration.

### Rule 4 — Commit All Migration Files to Git

All migration files must be committed to Git. A new development machine must obtain the same migration files through Git rather than reconstructing them manually.

Do not maintain machine-specific migration SQL files.

### Rule 5 — Never Reset `_sqlx_migrations`

Never delete or truncate the `_sqlx_migrations` table to bypass checksum validation. This destroys the migration history and can cause data loss or schema inconsistencies.

### Rule 6 — Never Automatically Repair a Checksum Mismatch

Application startup must never automatically repair a checksum mismatch. If a mismatch is detected, the application must fail clearly and report the problem.

## Diagnosing `VersionMismatch`

A `VersionMismatch(N)` error means migration version `N` has already been applied to the database, but the checksum stored in `_sqlx_migrations` differs from the checksum of the current local migration file.

### Common Causes

1. An already-applied migration file was edited after being applied.
2. Different computers are using different Git commits or branches.
3. The `.env` file points to an unexpected or shared database.
4. A previously modified migration was committed to Git.
5. The database schema and migration history were manually modified or reset inconsistently.

### Diagnostic Commands

```sh
# Check applied migrations and their checksums
psql $DATABASE_URL -c "SELECT version, description, installed_on, success, encode(checksum, 'hex') AS checksum FROM _sqlx_migrations ORDER BY version;"

# Check current database schema
psql $DATABASE_URL -c "\dt"
psql $DATABASE_URL -c "\d users"
psql $DATABASE_URL -c "\d settings"
psql $DATABASE_URL -c "\d api_credentials"
psql $DATABASE_URL -c "\d user_preferences"

# Verify migration checksums
pnpm db:check
```

### Recovery Procedures

**If the database contains the expected schema for the original migration:**
1. Identify the canonical original migration file from Git history.
2. Restore that exact migration file.
3. Do not modify the checksum stored in PostgreSQL.
4. Inspect any subsequent schema changes that may also have been incorrectly placed in old migrations.
5. Move necessary schema changes into a new forward migration.
6. Run migration validation.
7. Verify the final schema.

**If a new computer points to an unexpected database:**
Correct the local `.env` so the application uses the intended development database. Do not alter the existing database's migration history.

**If a new development database is empty:**
Create and initialize the intended local development database. Run all committed migrations in order. Do not copy or modify another database's `_sqlx_migrations` records.

**If database schema and migration history disagree:**
Do not reset migration history blindly. First compare the actual database schema, recorded applied migrations, and canonical Git migration files. Prepare a forward-only reconciliation migration where appropriate. If recovery could destroy existing data, stop and report the exact risk instead of executing destructive operations.

## Development Database Strategy

### Remote Databases

This project uses two independent remote PostgreSQL databases:

- `trading_terminal_dev` — used by all developers for application data and user preferences
- `trading_terminal_test` — used for automated integration tests

Both development computers use the same remote development database so that application data and user preferences remain consistent.

Both computers must use the same canonical migration files from Git.

### Environment Variables

- `DATABASE_URL` — connection string for the development database
- `TEST_DATABASE_URL` — connection string for the test database

These must be strictly separated. The application never silently falls back from `TEST_DATABASE_URL` to `DATABASE_URL`.

### Test Database Concurrency

Because multiple developers may execute tests against the same remote test database, concurrent test runs are prevented using PostgreSQL advisory locking.

The test harness acquires a session-level advisory lock before running tests and releases it after completion. This prevents concurrent test processes from corrupting each other's state.

## New Machine Bootstrap

1. Clone the Git repository.
2. Install the pinned Node.js and pnpm versions.
3. Install the Rust toolchain.
4. Configure `.env` from `.env.example`.
5. Run `pnpm install`.
6. Run `pnpm db:check` to verify migration checksums.
7. Start with `pnpm dev`.

## Adding a New Migration

1. Create a new SQL file in `apps/server/crates/server/migrations/` with the next unused version number.
2. Write the schema change SQL.
3. Commit the file to Git.
4. Run `pnpm db:check` to verify.
5. Deploy the migration to staging and production databases.

## Validation

```sh
pnpm db:check
```

This command:
1. Connects to the configured development database using `DATABASE_URL`.
2. Verifies existing migration checksums.
3. Reports applied migrations.
4. Reports pending migrations.
5. Detects missing or mismatched migrations.
6. Exits non-zero on inconsistency.
7. Never applies, reverts, deletes, or modifies migrations.