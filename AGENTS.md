# Repository guidance

This repository is a compact fork of
[`androso/reader-backend`](https://github.com/androso/reader-backend). Treat the
upstream repository as the fuller product reference, while keeping this fork
deployable in a simple, low-service environment.

The intended default runtime is the API and web app, with Postgres-backed book
processing running in the API process. The Redis/BullMQ worker is legacy and
optional. Prefer local Postgres with pgvector and the existing compact
Lightsail/container path over introducing mandatory Redis, a separate worker,
Chroma, ECS, or other multi-service infrastructure.

Keep upstream RAG evaluation, reranking, and shadow tooling out of this compact
fork, along with ECS and other multi-service deployment complexity.

When comparing or porting upstream work, separate product and safety behavior
from operational complexity. Port authentication, authorization, validation,
data-integrity, and user-facing fixes when applicable; adapt queueing,
observability, evaluation, and deployment changes to this repository's simpler
runtime instead of copying upstream infrastructure wholesale.

Keep README setup and deployment claims aligned with the code that actually
runs here. Before changing runtime boundaries, inspect `README.md`, the root
scripts, `apps/api/src/services/BookProcessingRunner.ts`, and the Lightsail
deployment files.

## Upstream issue work

Use the issue in the
[`Compact upstream parity` milestone](https://github.com/androso/reader-monorepo/milestone/1)
as the scope contract, and satisfy its linked dependencies before starting.
Upstream pull requests and commits are design references, not instructions to
merge or cherry-pick the full upstream change.

Keep each implementation issue-scoped. Preserve existing books with forward
migrations and compatibility handling, keep `bookId` as the public identity and
`fileKey` as an internal storage detail, and update API and web callers together
when their contract changes. Do not replace the Postgres-backed runner in
`apps/api/src/services/BookProcessingRunner.ts` with Redis or BullMQ.

Preserve the security and data boundaries already established here. Browser
authentication uses the HttpOnly session cookie, unsafe requests require the
configured trusted origin, and resource ownership must be checked before
storage access, database writes, SSE headers, retrieval, or model calls. Public
book and message projections must not expose storage keys, collection names, or
private execution metadata.

Validate uploaded contents before any persistent write. Keep failed queue work
and deletion cleanup retryable, retain compatibility for legacy file keys and
collection names, and keep progress writes owner-scoped and atomic. Chat history
comes from PostgreSQL rather than client transcripts, completion outcomes are
persisted, and missing or unavailable book context fails closed. EPUB HTML is
sanitized centrally in `@reader/epub`; reader navigation, object URLs, and lazy
cover requests must retain their existing bounds and cleanup guarantees.

When a public contract or runtime variable changes, update Swagger/OpenAPI,
environment templates, README setup, and both Lightsail guides in the same
issue. Keep optional Langfuse metadata tracing distinct from the excluded RAG
evaluation, reranking, and shadow systems.

Add focused regression tests around the boundary being changed, especially
owner/non-owner behavior, migration of legacy rows, queue and deletion races,
and malformed EPUB or upload inputs. Run the affected package tests first,
then `pnpm build` and `git diff --check` before handing work off.
