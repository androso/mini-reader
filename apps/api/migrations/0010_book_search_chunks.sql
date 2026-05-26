CREATE TABLE IF NOT EXISTS "book_search_chunks" (
    "id" text PRIMARY KEY NOT NULL,
    "collection_name" text NOT NULL,
    "chunk_index" integer NOT NULL,
    "content" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "book_search_chunks_collection_chunk_idx"
ON "book_search_chunks" ("collection_name", "chunk_index");
