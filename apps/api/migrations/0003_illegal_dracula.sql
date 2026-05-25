ALTER TABLE "conversations" RENAME COLUMN "resouce_id" TO "resource_id";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "content" text NOT NULL;