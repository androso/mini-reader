CREATE TYPE "public"."reader_package_job_status" AS ENUM('queued', 'processing', 'retrying', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "mobile_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_chapters" (
	"book_id" uuid NOT NULL,
	"id" text NOT NULL,
	"title" text,
	"href" text NOT NULL,
	"chapter_order" integer NOT NULL,
	"blocks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reader_chapters_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
CREATE TABLE "reader_package_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "reader_package_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_resources" (
	"book_id" uuid NOT NULL,
	"id" text NOT NULL,
	"storage_key" text NOT NULL,
	"media_type" text NOT NULL,
	"size" integer NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reader_resources_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "reader_package_status" text DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "reader_package_error" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "reader_package_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_chapters" ADD CONSTRAINT "reader_chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_package_jobs" ADD CONSTRAINT "reader_package_jobs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_package_jobs" ADD CONSTRAINT "reader_package_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_resources" ADD CONSTRAINT "reader_resources_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobile_sessions_user_id_idx" ON "mobile_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mobile_sessions_expires_at_idx" ON "mobile_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_chapters_book_order_idx" ON "reader_chapters" USING btree ("book_id","chapter_order");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_package_jobs_book_id_idx" ON "reader_package_jobs" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "reader_package_jobs_due_idx" ON "reader_package_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_resources_storage_key_idx" ON "reader_resources" USING btree ("storage_key");