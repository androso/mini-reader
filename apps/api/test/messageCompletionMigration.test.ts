import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";

const migrationRoot = existsSync("migrations/0015_daffy_runaways.sql")
    ? "migrations"
    : "apps/api/migrations";
const migration = readFileSync(
    `${migrationRoot}/0015_daffy_runaways.sql`,
    "utf8"
);
const snapshot = JSON.parse(
    readFileSync(`${migrationRoot}/meta/0015_snapshot.json`, "utf8")
) as {
    enums: Record<string, { values: string[] }>;
    tables: Record<string, { columns: Record<string, { notNull: boolean }> }>;
};

test("0015 adds nullable completion fields and backfills assistants only", () => {
    assert.match(
        migration,
        /CREATE TYPE "public"\."message_completion_status" AS ENUM\('complete', 'truncated', 'cancelled', 'failed'\)/
    );
    assert.match(migration, /ADD COLUMN "completion_status"/);
    assert.match(migration, /ADD COLUMN "finish_reason" text/);
    assert.match(
        migration,
        /UPDATE "messages"[\s\S]*SET "completion_status" = 'complete'[\s\S]*WHERE "role" = 'assistant'/
    );
    assert.doesNotMatch(migration, /WHERE "role" = 'user'/);

    assert.deepEqual(
        snapshot.enums["public.message_completion_status"].values,
        ["complete", "truncated", "cancelled", "failed"]
    );
    assert.equal(
        snapshot.tables["public.messages"].columns.completion_status.notNull,
        false
    );
    assert.equal(
        snapshot.tables["public.messages"].columns.finish_reason.notNull,
        false
    );
});

test(
    "0015 backfills completion outcomes in a disposable PostgreSQL database",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_message_completion",
            { migrate: false },
            async ({ client: database }) => {
                await database.query(`
                    CREATE TYPE "message_role" AS ENUM ('user', 'assistant');
                    CREATE TABLE "messages" (
                        "id" uuid PRIMARY KEY,
                        "conversation_id" uuid NOT NULL,
                        "role" "message_role" NOT NULL,
                        "content" text NOT NULL,
                        "context_sources" jsonb,
                        "created_at" timestamp NOT NULL DEFAULT now()
                    );
                    INSERT INTO "messages" (
                        "id", "conversation_id", "role", "content"
                    ) VALUES
                        ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'user', 'question'),
                        ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'assistant', 'answer');
                `);

                await database.query(migration);

                const messages = await database.query<{
                    role: "user" | "assistant";
                    completion_status: string | null;
                    finish_reason: string | null;
                }>(`
                    SELECT "role", "completion_status", "finish_reason"
                    FROM "messages"
                    ORDER BY "id"
                `);
                assert.deepEqual(messages.rows, [
                    {
                        role: "user",
                        completion_status: null,
                        finish_reason: null,
                    },
                    {
                        role: "assistant",
                        completion_status: "complete",
                        finish_reason: null,
                    },
                ]);

                const columns = await database.query<{
                    column_name: string;
                    is_nullable: string;
                }>(`
                    SELECT "column_name", "is_nullable"
                    FROM "information_schema"."columns"
                    WHERE "table_schema" = 'public'
                      AND "table_name" = 'messages'
                      AND "column_name" IN ('completion_status', 'finish_reason')
                    ORDER BY "column_name"
                `);
                assert.deepEqual(columns.rows, [
                    {
                        column_name: "completion_status",
                        is_nullable: "YES",
                    },
                    { column_name: "finish_reason", is_nullable: "YES" },
                ]);
            }
        );
    }
);
