CREATE TYPE "public"."file_type" AS ENUM('epub', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('book', 'article');--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "content" text NOT NULL;