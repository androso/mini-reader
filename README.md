# Reader Platform

[![CI](https://github.com/androso/reader-monorepo/actions/workflows/ci.yml/badge.svg)](https://github.com/androso/reader-monorepo/actions/workflows/ci.yml)
[![CodeQL](https://github.com/androso/reader-monorepo/actions/workflows/codeql.yml/badge.svg)](https://github.com/androso/reader-monorepo/actions/workflows/codeql.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Reader Platform is a self-hosted web application for reading EPUB and PDF
books, tracking reading progress, and chatting against private book context.
It combines a Next.js frontend, an Express API, and PostgreSQL with pgvector in
one pnpm workspace.

The default deployment intentionally stays small: the API processes books in
process through a PostgreSQL-backed queue, and PostgreSQL is the only required
data service. Redis, BullMQ, Chroma, a separate worker, RAG evaluation,
reranking, and shadow infrastructure are outside the project's runtime scope.

## Layout

- `apps/api`: Express API for auth, books, chat, progress, storage, and current ingestion flow.
- `apps/web`: Next.js frontend for the library, reader, auth, and chat UI.
- `packages/epub`: shared EPUB parsing utilities.
- `packages/processing`: shared PDF/EPUB ingestion pipeline.
- `packages/providers`: shared storage, vector store, and provider integrations.
- `drizzle.config.ts`: root Drizzle config pointing at the API schema and migrations.

## Quick start

Prerequisites:

- Node.js 22
- pnpm 10.11.1 through Corepack
- Docker with Compose, or an existing PostgreSQL 16 server with pgvector

Install dependencies and start PostgreSQL:

```bash
corepack enable
corepack prepare pnpm@10.11.1 --activate
pnpm install --frozen-lockfile
docker compose -f compose.dev.yml up -d
```

Create local environment files and set a development JWT secret:

```bash
cp .env.template .env
cp apps/web/.env.template apps/web/.env
```

The template's PostgreSQL URL matches `compose.dev.yml`. Set `JWT_SECRET` to a
random local value. `OPENAI_API_KEY` remains required for book ingestion,
semantic retrieval through `/v1/embeddings`, and default book-grounded chat.
Never commit either generated environment file.

Apply migrations and start both applications:

```bash
pnpm db:migrate
pnpm dev
```

Open <http://localhost:3001>. The API health endpoint is
<http://localhost:3000/health>, and interactive API documentation is available
at <http://localhost:3000/api-docs>.

For local auth, use the development sign-in shown on the login page. It calls
`/api/auth/dev` with `DEV_USER_EMAIL` and `DEV_USER_NAME`. Email/password signup
and login are also available; Google OAuth values are optional in development.

To stop the development database without deleting its data:

```bash
docker compose -f compose.dev.yml down
```

## Project status and support

Reader Platform is community-maintained software without a hosted service or
support SLA. Use [Discussions](https://github.com/androso/reader-monorepo/discussions)
for questions, [Issues](https://github.com/androso/reader-monorepo/issues) for
reproducible bugs, and the private process in [SECURITY.md](SECURITY.md) for
vulnerabilities. Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md)
and the [Code of Conduct](CODE_OF_CONDUCT.md).

## Commands

- `pnpm dev`: run the API and web app in development mode. The API runs the Postgres-backed book processing runner in-process.
- `pnpm build`: compile the backend packages and API app.
- `pnpm test`: run EPUB, processing, API, and web tests.
- `pnpm api:dev`: run only the API app on port `3000`.
- `pnpm web:dev`: run the Next.js web app on port `3001`.
- `pnpm web:build`: build the Next.js web app.
- `pnpm format:check`: verify repository formatting.
- `pnpm db:generate`: generate Drizzle migrations from the API schema.
- `pnpm db:migrate`: apply Drizzle migrations using `.env`.
- `pnpm --filter @reader/api <script>`: run an API-specific script directly.
- `pnpm --filter @reader/web <script>`: run a web-specific script directly.

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

The browser can sign up with email and password via `POST /api/auth/signup`
or log in via `POST /api/auth/login`. Signups collect a unique email, password,
and username (3-30 characters using letters, numbers, or underscores). The
backend normalizes email and username to lowercase, hashes passwords with
scrypt, and sets a seven-day HttpOnly session cookie without returning a bearer
token. Email confirmation is intentionally deferred, and signup returns `409`
if an email or username is already registered. Missing users, Google-only rows,
and wrong passwords return `401 Invalid email or password` with constant-time scrypt path execution.
Alternatively, the browser sends a Google Identity Services ID token to
`POST /api/auth/google`. The API verifies it against `GOOGLE_CLIENT_ID` and
sets the session cookie.
Production uses `__Host-reader_session` with `Secure`, `SameSite=Lax`, and
`Path=/`, while local development uses the non-secure `reader_session` name.
Browser API calls include credentials, and `POST /api/auth/logout` clears both
cookie names and returns `204`.

`FRONTEND_URL` must be the exact browser origin, including its scheme and port
when one is present. The API rejects every unsafe request whose `Origin` does
not match it. Local development may use `NEXT_PUBLIC_API_URL` to call the API
on a different port; production leaves that variable empty so Caddy serves the
web app and `/api/*` from one HTTPS origin. Caddy is the only trusted proxy hop.

Experimental per-user Codex subscription chat is disabled by default. To opt in,
set `CODEX_OAUTH_ENABLED=true` and generate
`CODEX_CREDENTIAL_ENCRYPTION_KEY` with `openssl rand -base64 32`. Users connect
under **Settings → AI provider** with a manual flow: after authorization, they
copy the unreachable `http://localhost:1455/auth/callback?...` URL from the
browser bar and paste it into Reader. Codex then covers generated chat responses
for that user only; ingestion and semantic search still use `OPENAI_API_KEY`.
Rotating the encryption key without re-encrypting stored rows disconnects
existing Codex accounts.

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
The reader restores the owner's saved block and chapter, and its bounded
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

## License

Reader Platform is licensed under Apache-2.0. See [LICENSE](LICENSE),
[NOTICE](NOTICE), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
