CREATE TYPE "public"."message_completion_status" AS ENUM('complete', 'truncated', 'cancelled', 'failed');--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "completion_status" "message_completion_status";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "finish_reason" text;--> statement-breakpoint
UPDATE "messages"
SET "completion_status" = 'complete'
WHERE "role" = 'assistant';
