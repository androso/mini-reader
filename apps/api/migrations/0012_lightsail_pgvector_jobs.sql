CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN
 CREATE TYPE "book_processing_job_status" AS ENUM ('queued', 'processing', 'retrying', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "book_search_chunks"
ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

CREATE INDEX IF NOT EXISTS "book_search_chunks_embedding_idx"
ON "book_search_chunks"
USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE IF NOT EXISTS "book_processing_jobs" (
    "id" text PRIMARY KEY NOT NULL,
    "book_id" uuid NOT NULL REFERENCES "books"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL,
    "file_key" text NOT NULL,
    "file_type" "file_type" NOT NULL,
    "status" "book_processing_job_status" DEFAULT 'queued' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "last_error" text,
    "available_at" timestamp DEFAULT now() NOT NULL,
    "locked_at" timestamp,
    "completed_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "book_processing_jobs_book_id_idx"
ON "book_processing_jobs" ("book_id");

CREATE INDEX IF NOT EXISTS "book_processing_jobs_due_idx"
ON "book_processing_jobs" ("status", "available_at");
