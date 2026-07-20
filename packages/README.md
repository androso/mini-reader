# Shared packages

These packages hold implementation shared across the compact API and web app:

- `epub` parses EPUB metadata, spine, table of contents, hrefs, and text blocks.
  It is also the single HTML sanitization boundary used before book markup is
  rendered.
- `jobs` defines the book-processing payload containing both public `bookId`
  and private `fileKey`. The default API runner uses this payload with its
  PostgreSQL queue.
- `processing` performs lossless PDF/EPUB extraction and ingestion and derives
  new collection names from the book UUID.
  pgvector is the only vector store driver; Chroma has been removed.

The default deployment does not require Redis, BullMQ, Chroma, a separate
worker, or upstream RAG evaluation, reranking, and shadow tooling. The
Redis/BullMQ worker has been removed; these packages no longer contain queue
or worker code.

Potential future packages, such as shared database repositories, generated API
contracts, or domain-only types, should be added only when they reduce real
duplication without introducing another runtime service.
