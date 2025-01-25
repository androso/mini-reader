ALTER TABLE "books" ADD COLUMN "file_type" "file_type";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "content";--> statement-breakpoint
DROP TYPE "public"."message_role";--> statement-breakpoint
DROP TYPE "public"."resource_type";