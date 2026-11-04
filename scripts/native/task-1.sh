#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/../.."
cd apps/server && cargo run --bin server
