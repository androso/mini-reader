CREATE TABLE "progress" (
	"user_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"progress_position" text NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
