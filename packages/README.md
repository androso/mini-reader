# Shared packages

These packages hold implementation shared across the compact API, web app, and
legacy worker without changing the default two-app runtime:

- `epub` parses EPUB metadata, spine, table of contents, hrefs, and text blocks.
  It is also the single HTML sanitization boundary used before book markup is
  rendered.
- `jobs` defines the book-processing payload containing both public `bookId`
  and private `fileKey`. Its BullMQ helpers exist for the optional legacy worker;
  the default API runner uses the same payload with its PostgreSQL queue.
- `processing` performs lossless PDF/EPUB extraction and ingestion and derives
  new collection names from the book UUID.
- `providers` supplies local or S3 file storage and vector-store adapters.
  pgvector is the compact default; Chroma remains a legacy compatibility path.

The default deployment does not require Redis, BullMQ, Chroma, a separate
worker, or upstream RAG evaluation, reranking, and shadow tooling.

Potential future packages, such as shared database repositories, generated API
contracts, or domain-only types, should be added only when they reduce real
duplication without introducing another runtime service.
