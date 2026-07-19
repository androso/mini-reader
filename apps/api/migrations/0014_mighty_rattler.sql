WITH "legacy_book_matches" AS (
	SELECT
		"progress"."ctid" AS "progress_ctid",
		"books"."id",
		row_number() OVER (
			PARTITION BY "progress"."ctid"
			ORDER BY "books"."created_at" DESC, "books"."id" DESC
		) AS "match_number"
	FROM "progress"
	INNER JOIN "books"
		ON "books"."file_key" = "progress"."book_id"
		AND "books"."user_id" = "progress"."user_id"
)
UPDATE "progress"
SET "book_id" = "legacy_book_matches"."id"::text
FROM "legacy_book_matches"
WHERE "progress"."ctid" = "legacy_book_matches"."progress_ctid"
	AND "legacy_book_matches"."match_number" = 1;--> statement-breakpoint
DELETE FROM "progress"
WHERE NOT EXISTS (
	SELECT 1
	FROM "users"
	WHERE "users"."id" = "progress"."user_id"
);--> statement-breakpoint
DELETE FROM "progress"
WHERE NOT pg_input_is_valid("book_id", 'uuid');--> statement-breakpoint
DELETE FROM "progress"
WHERE NOT EXISTS (
	SELECT 1
	FROM "books"
	WHERE "books"."id" = "progress"."book_id"::uuid
);--> statement-breakpoint
DELETE FROM "progress"
USING (
	SELECT "ctid"
	FROM (
		SELECT
			"ctid",
			row_number() OVER (
				PARTITION BY "user_id", "book_id"
				ORDER BY "updated_at" DESC, "last_read_at" DESC, "created_at" DESC, "ctid" DESC
			) AS "row_number"
		FROM "progress"
	) AS "ranked"
	WHERE "ranked"."row_number" > 1
) AS "duplicates"
WHERE "progress"."ctid" = "duplicates"."ctid";--> statement-breakpoint
ALTER TABLE "progress" ALTER COLUMN "book_id" SET DATA TYPE uuid USING "book_id"::uuid;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_user_id_book_id_pk" PRIMARY KEY("user_id","book_id");--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
