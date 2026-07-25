CREATE TABLE "codex_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"account_id" text,
	"email" text,
	"plan_type" text,
	"pending_state" text,
	"pending_verifier_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"pending_expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"reauth_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "codex_credentials" ADD CONSTRAINT "codex_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;