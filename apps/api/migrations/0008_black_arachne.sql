ALTER TABLE "progress" ALTER COLUMN "book_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "progress" ADD COLUMN "progress_chapter" text NOT NULL;