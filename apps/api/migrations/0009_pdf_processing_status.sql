ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "processing_status" text DEFAULT 'processing' NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "processing_error" text;--> statement-breakpoint
UPDATE "books" SET "processing_status" = 'ready' WHERE "collection_name" IS NOT NULL;--> statement-breakpoint
UPDATE "books"
SET
    "processing_status" = 'failed',
    "processing_error" = 'No selectable text found in PDF. This PDF may be scanned or image-only, and OCR is not enabled yet.'
WHERE
    "collection_name" IS NULL
    AND ("file_type" = 'pdf' OR "file_key" LIKE 'pdf-%');
