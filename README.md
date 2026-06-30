# Reader Platform

Reader Platform is a pnpm workspace for the Reader API, web app, in-process
book processor, and shared ingestion packages.

## Layout

- `apps/api`: Express API for auth, books, chat, progress, storage, and current ingestion flow.
- `apps/web`: Next.js frontend for the library, reader, auth, and chat UI.
- `apps/worker`: legacy BullMQ worker, kept for explicit Redis-backed worker runs only.
- `packages/epub`: shared EPUB parsing utilities.
- `packages/jobs`: shared book-processing job helpers.
- `packages/processing`: shared PDF/EPUB ingestion pipeline.
- `packages/providers`: shared storage, vector store, and provider integrations.
- `drizzle.config.ts`: root Drizzle config pointing at the API schema and migrations.

## Setup

Install dependencies from the repository root:

```bash
pnpm install
```

Create local environment files:

```bash
cp .env.template .env
cp apps/web/.env.template apps/web/.env
```

Local development expects these services to be available:

- PostgreSQL with pgvector enabled, matching `DATABASE_URL`.
- OpenAI credentials, via `OPENAI_API_KEY`, when ingesting books or chatting with document context.

For local auth, the API supports `/api/auth/dev` through `DEV_USER_EMAIL` and
`DEV_USER_NAME`. Google OAuth values are still required for production.

## Commands

- `pnpm dev`: run the API and web app in development mode. The API runs the Postgres-backed book processing runner in-process.
- `pnpm build`: compile the backend packages, API app, and worker app.
- `pnpm test`: run package, API, and worker tests.
- `pnpm api:dev`: run only the API app on port `3000`.
- `pnpm worker:dev`: run the legacy Redis/BullMQ worker explicitly.
- `pnpm web:dev`: run the Next.js web app on port `3001`.
- `pnpm web:build`: build the Next.js web app.
- `pnpm web:lint`: run the web lint script.
- `pnpm db:generate`: generate Drizzle migrations from the API schema.
- `pnpm db:migrate`: apply Drizzle migrations using `.env`.
- `pnpm --filter @reader/api <script>`: run an API-specific script directly.
- `pnpm --filter @reader/web <script>`: run a web-specific script directly.
- `pnpm --filter @reader/worker <script>`: run a worker-specific script directly.

## Development Flow

Use `pnpm dev` for the normal full-stack loop. It starts:

- `@reader/api` with `ts-node-dev`.
- `@reader/web` with Next.js on port `3001`.

The API listens on `PORT` from `.env`, defaulting to `3000`. The web app calls
the API through `NEXT_PUBLIC_API_URL` from `apps/web/.env`.

Book uploads are processed asynchronously. The API stores the uploaded file,
inserts a `processing` book row, enqueues a Postgres-backed job, and returns
immediately while the API's in-process runner finishes PDF/EPUB ingestion.

## AWS infrastructure

For the low-cost AWS deployment, use Lightsail with one app container, local
Postgres/pgvector, and S3 uploads. CloudFormation provisions the Lightsail
instance, static IP, S3 bucket or bucket access, and first-boot bootstrap.

Follow `docs/aws-lightsail-cloudformation-deploy.md`. The manual setup guide in
`docs/aws-lightsail-deploy.md` is retained as an operational fallback for SSH
updates and recovery.
