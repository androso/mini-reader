# Reader Platform

Reader Platform is a compact fork of
[`androso/reader-backend`](https://github.com/androso/reader-backend). It keeps
the Reader API, web app, book ingestion, and shared packages in a pnpm
workspace, but is designed to run in a simple environment with fewer services
and less deployment machinery than the upstream repository.

## Fork scope

This fork favors one small deployment over upstream's production-oriented
service split. The normal runtime starts the API and web app, runs book
processing inside the API through a Postgres-backed queue, and can use local
Postgres with pgvector. The Redis/BullMQ worker remains available only for
explicit legacy worker runs.

This fork does not track every upstream feature. It includes the upstream
authentication, authorization, storage, validation, data-integrity, and reader
safety work selected for the compact parity milestone, while leaving out RAG
evaluation, reranking and shadow tooling, ECS-oriented automation, and new
CI/CD machinery. Redis, BullMQ, and Chroma remain optional compatibility paths,
not requirements for the normal deployment.

Selected upstream product, security, storage, and data-integrity improvements
are tracked in the
[`Compact upstream parity` milestone](https://github.com/androso/reader-monorepo/milestone/1).
That milestone adapts behavior to this repository; it does not bring over the
upstream RAG evaluation system, reranking and shadow infrastructure, or ECS
deployment stack.

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
- `pnpm test`: run EPUB, processing, API, worker, and web tests.
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

The API applies process-local request limits: 20 authentication requests per
15 minutes per client IP, 10 uploads per hour per user, and 30 chat mutations
per minute per user. These bounded counters assume one API replica and reset
when the process restarts; a horizontally scaled deployment would need a shared
rate-limit store.

## Browser security and authentication

The browser sends a Google Identity Services ID token to
`POST /api/auth/google`. The API verifies it against `GOOGLE_CLIENT_ID` and
sets a seven-day HttpOnly session cookie; it does not return a bearer token.
Production uses `__Host-reader_session` with `Secure`, `SameSite=Lax`, and
`Path=/`, while local development uses the non-secure `reader_session` name.
Browser API calls include credentials, and `POST /api/auth/logout` clears both
cookie names and returns `204`.

`FRONTEND_URL` must be the exact browser origin, including its scheme and port
when one is present. The API rejects every unsafe request whose `Origin` does
not match it. Local development may use `NEXT_PUBLIC_API_URL` to call the API
on a different port; production leaves that variable empty so Caddy serves the
web app and `/api/*` from one HTTPS origin. Caddy is the only trusted proxy hop.

## Book and reader guarantees

The public identity of a book is its UUID `bookId`. List and upload responses
contain only `id`, `title`, `fileType`, processing state and error, and creation
time; storage keys, collection names, and ownership fields stay private. File,
status, retry, deletion, progress, chat, reader, and cover requests all use the
UUID. New originals are stored at
`users/{userId}/books/{bookId}/original`, and new vector collections use
`book_<uuid_with_underscores>`. Forward migrations and cleanup logic retain
support for existing books with legacy keys or collection names.

Uploads are validated before storage, database insertion, or queueing. Multer
keeps the compressed request limit at 80 MiB. PDFs must begin with `%PDF-`;
EPUBs must be valid ZIP archives with CRC-valid entries and
`META-INF/container.xml`. EPUB validation rejects absolute or traversing paths,
more than 5,000 entries, more than 500 MiB expanded in total, an entry larger
than 50 MiB, or an expansion ratio above 100:1. Invalid content receives a
generic `400` response without parser or archive details.

If queueing fails, the original remains stored and the book becomes
`queue_failed`; `POST /api/books/{bookId}/retry` retries an owned book in
`queue_failed` or `failed`. Deletion first marks a book `deleting` and removes
queued work. It protects shared legacy artifacts, prevents a late processor
from publishing the book again, and leaves failed cleanup retryable by sending
the same `DELETE /api/books/{bookId}` request again.

Progress is owner-scoped by `(userId, bookId)` and saved with an atomic upsert.
The reader restores a clamped percentage once its layout stabilizes, and its
navigation helpers do not write invalid or unchanged positions. EPUB markup is
sanitized in `@reader/epub`; object URLs are revoked when books change or the
reader unmounts. Library EPUB covers load once they approach within 200px of
the viewport, fetch the protected UUID endpoint with credentials, and clean up
their observer, request, and blob URL.

Book chat authorizes the resource before conversation writes, SSE headers,
retrieval, or model calls. PostgreSQL is the source of history: the API accepts
one trimmed message up to 8,000 characters, ignores client-supplied roles or
transcripts, and sends the newest history fitting both 30 messages and 60,000
characters. Streams end with a terminal `complete`, `truncated`, `cancelled`,
or `failed` outcome. Missing, processing, failed, or unavailable book context
fails closed; a legitimate no-match returns a fixed complete refusal. Public
message responses omit private execution metadata.

The migration sequence implementing the compact runtime is `0012` for the
Postgres queue and pgvector, `0013` for legacy file-type backfill, `0014` for
UUID progress ownership and foreign keys, `0015` for completion outcomes, and
`0016` for private execution metadata. Apply it with `pnpm db:migrate` before
starting an updated deployment.

Interactive API documentation is available at `/api-docs`, with the generated
OpenAPI JSON at `/api-docs.json`. It describes cookie authentication and public
schemas only; storage keys and private chat execution metadata are not part of
the API contract.

## AWS infrastructure

For the low-cost AWS deployment, use Lightsail with one app container, local
Postgres/pgvector, and S3 uploads. CloudFormation provisions the Lightsail
instance, static IP, S3 bucket or bucket access, and first-boot bootstrap.

Follow `docs/aws-lightsail-cloudformation-deploy.md`. The manual setup guide in
`docs/aws-lightsail-deploy.md` is retained as an operational fallback for SSH
updates and recovery.
