# Shared Packages

This directory is reserved for shared monorepo packages.

Current packages:

- `epub`: shared EPUB metadata, spine, ToC, href, and text-block processing.
- `jobs`: BullMQ queue names, job payloads, Redis connection, and enqueue helpers.
- `providers`: storage and vector search adapters shared by API and worker.
- `processing`: PDF/EPUB ingestion orchestration for search indexing.

Deferred packages:

- `db`: Drizzle schema, migrations, and repositories.
- `contracts`: request/response schemas and generated API types.
- `domain`: core book, reader, chat, progress, and ingestion types.
