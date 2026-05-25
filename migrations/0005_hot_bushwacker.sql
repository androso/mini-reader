CREATE TYPE "public"."file_type" AS ENUM('epub', 'pdf');--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "file_type" "file_type";
