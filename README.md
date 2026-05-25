# Reader Platform

This repository is now structured as the Reader platform monorepo. The current backend API lives in `apps/api`; future independently deployable services and shared packages should be added beside it.

## Layout

- `apps/api`: Express API for auth, books, chat, progress, storage, and current ingestion flow.
- `apps/web`: Next.js frontend for the library, reader, auth, and chat UI.
- `packages/`: reserved for shared workspace packages such as `db`, `contracts`, `domain`, and provider adapters.
- `drizzle.config.ts`: root Drizzle config pointing at the API schema and migrations during the transition.

## Commands

- `pnpm dev`: run the API app in development mode.
- `pnpm build`: compile the API app.
- `pnpm web:dev`: run the Next.js web app on port `3001`.
- `pnpm web:build`: build the Next.js web app.
- `pnpm web:lint`: run the web lint script.
- `pnpm --filter @reader/api <script>`: run an API-specific script directly.
- `pnpm --filter @reader/web <script>`: run a web-specific script directly.

## Migration Notes

This first step preserves API and web behavior while changing the repository shape. The next architecture step should extract database schema/repositories into `packages/db`, then move EPUB/PDF processing into an `apps/worker` entrypoint.
