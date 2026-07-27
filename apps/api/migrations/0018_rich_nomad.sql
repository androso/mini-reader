ALTER TABLE "books" ADD COLUMN "original_filename" text;--> statement-breakpoint
UPDATE "books" SET "original_filename" = "title" WHERE "original_filename" IS NULL;--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "original_filename" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "embedded_title" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "creator" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "identifier" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "metadata_extracted_at" timestamp;