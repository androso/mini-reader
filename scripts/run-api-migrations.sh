#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the production RDS connection string}"

pnpm exec drizzle-kit migrate --config drizzle.config.ts
