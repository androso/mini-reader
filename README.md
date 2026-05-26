# Reader Platform

This repository is now structured as the Reader platform monorepo. The current backend API lives in `apps/api`; future independently deployable services and shared packages should be added beside it.

## Layout

- `apps/api`: Express API for auth, books, chat, progress, storage, and current ingestion flow.
- `apps/web`: Next.js frontend for the library, reader, auth, and chat UI.
- `packages/`: shared workspace packages for EPUB parsing, providers, and synchronous book processing.
- `drizzle.config.ts`: root Drizzle config pointing at the API schema and migrations during the transition.

## Commands

- `pnpm dev`: run the API app in development mode.
- `pnpm build`: compile the backend packages and API app.
- `pnpm web:dev`: run the Next.js web app on port `3001`.
- `pnpm web:build`: build the Next.js web app.
- `pnpm web:lint`: run the web lint script.
- `pnpm --filter @reader/api <script>`: run an API-specific script directly.
- `pnpm --filter @reader/web <script>`: run a web-specific script directly.

## Migration Notes

Book uploads are processed synchronously by the API. There is no Redis or worker process required for the current ingestion flow.
