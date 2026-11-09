# trading-terminal

Created with [Better Fullstack](https://github.com/Marve10s/Better-Fullstack).

## Applications and resources

- **tanstack-router** (typescript, frontend): `apps/web`; part `frontend:typescript:tanstack-router`
- **axum** (rust, backend): `apps/server`; part `backend:rust:axum`
- **postgres** (universal, database): `packages/db`; part `database:universal:postgres`
- **turborepo** (universal, workspaceRunner): `.`; part `workspacerunner:universal:turborepo`

## Setup

Install the SDKs for the selected languages before preparing dependencies. SwiftUI needs macOS, Xcode, and XcodeGen; Kotlin Android apps need a JDK and Android SDK; Flutter needs the Flutter SDK. Rust web apps also need the WebAssembly target and Trunk or Dioxus CLI.

JavaScript dependencies are installed at the workspace root. Each native application keeps its own toolchain. Native package scripts require `bash` on PATH; install Git Bash on Windows. Run the shell commands below in Bash.

If dependencies were not prepared during creation, run:

```sh
pnpm install
(cd 'apps/server' && cargo fetch)
```

Copy each application's `.env.example` to `.env` when present and configure database credentials before starting database-backed services.

## Local development

Start the selected web applications and backend services together:

```sh
pnpm run dev
```

The supervisor stops the other services when one exits. Native mobile applications run separately so you can choose a simulator or device. Open Kotlin applications in Android Studio.

### Rust Axum

Run independently from the project root:

```sh
cd apps/server && cargo run --bin server
```

## Connections

- **Rust Axum** (default client connection): `http://localhost:3000`, health endpoint `http://localhost:3000/health`.

Cross-language clients communicate over HTTP. Framework-specific clients such as tRPC are used only with compatible backends. Generated connection files identify the default backend; additional services retain their own paths and endpoints.

## Developer Setup

### Prerequisites

- **Node.js** — version pinned in `package.json` (`packageManager: pnpm@9.12.1`)
- **pnpm** — install via `corepack enable` or `npm install -g pnpm@9.12.1`
- **Rust** — latest stable toolchain (`rustup show` to verify)
- **PostgreSQL** — remote `trading_terminal_dev` and `trading_terminal_test` databases

### Bootstrap a New Computer

1. Clone the Git repository.
2. Install the pinned Node.js and pnpm versions.
3. Install the Rust toolchain.
4. Configure `.env` from `apps/server/.env.example`.
5. Run `pnpm install`.
6. Run `pnpm db:check` to verify migration checksums.
7. Start with `pnpm dev`.

### Database Configuration

This project uses two independent remote PostgreSQL databases:

- `trading_terminal_dev` — used by all developers for application data and user preferences
- `trading_terminal_test` — used for automated integration tests

Both development computers use the same remote development database so that application data and user preferences remain consistent.

Both computers must use the same canonical migration files from Git.

Environment variables:

- `DATABASE_URL` — connection string for the development database
- `TEST_DATABASE_URL` — connection string for the test database

These must be strictly separated. The application never silently falls back from `TEST_DATABASE_URL` to `DATABASE_URL`.

## Migration Policy

See [MIGRATION_POLICY.md](MIGRATION_POLICY.md) for the complete immutable migration policy.

### Quick Reference

- Never edit an already-applied migration.
- Every schema change requires a new sequential migration.
- All migration files must be committed to Git.
- Never reset `_sqlx_migrations` to bypass checksum validation.
- Never automatically repair a checksum mismatch.

### Adding a New Migration

1. Create a new SQL file in `apps/server/crates/server/migrations/` with the next unused version number.
2. Write the schema change SQL.
3. Commit the file to Git.
4. Run `pnpm db:check` to verify.
5. Deploy the migration to staging and production databases.

### Validation

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

## Diagnosing `VersionMismatch`

A `VersionMismatch(N)` error means migration version `N` has already been applied to the database, but the checksum stored in `_sqlx_migrations` differs from the checksum of the current local migration file.

### Diagnostic Commands

```sh
# Check applied migrations and their checksums
psql $DATABASE_URL -c "SELECT version, description, installed_on, success, encode(checksum, 'hex') AS checksum FROM _sqlx_migrations ORDER BY version;"

# Check current database schema
psql $DATABASE_URL -c "\dt"
psql $DATABASE_URL -c "\d users"

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