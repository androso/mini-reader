import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";

const migrationRoot = existsSync(
    "migrations/0016_message_execution_metadata.sql"
)
    ? "migrations"
    : "apps/api/migrations";
const migration = readFileSync(
    `${migrationRoot}/0016_message_execution_metadata.sql`,
    "utf8"
);
const snapshot = JSON.parse(
    readFileSync(`${migrationRoot}/meta/0016_snapshot.json`, "utf8")
) as {
    tables: Record<
        string,
        { columns: Record<string, { type: string; notNull: boolean }> }
    >;
};
const journal = JSON.parse(
    readFileSync(`${migrationRoot}/meta/_journal.json`, "utf8")
) as {
    entries: Array<{
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
    }>;
};

test("0016 adds one nullable private JSONB column", () => {
    assert.match(
        migration,
        /ALTER TABLE "messages" ADD COLUMN "execution_metadata" jsonb;/
    );
    assert.doesNotMatch(migration, /NOT NULL|UPDATE|prompt|pricing|retrieval/i);

    const columns = snapshot.tables["public.messages"].columns;
    assert.equal(columns.execution_metadata.type, "jsonb");
    assert.equal(columns.execution_metadata.notNull, false);
    assert.equal(columns.completion_status.type, "message_completion_status");
    assert.equal(columns.finish_reason.type, "text");

    assert.deepEqual(
        journal.entries.find(
            (entry) => entry.tag === "0016_message_execution_metadata"
        ),
        {
            idx: 16,
            version: "7",
            when: journal.entries[16]?.when,
            tag: "0016_message_execution_metadata",
            breakpoints: true,
        }
    );
});

test(
    "0016 preserves legacy rows and round-trips compact metadata in PostgreSQL",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_message_metadata",
            { migrate: false },
            async ({ client: database }) => {
                await database.query(`
                    CREATE TABLE "messages" (
                        "id" uuid PRIMARY KEY,
                        "role" text NOT NULL,
                        "content" text NOT NULL
                    );
                    INSERT INTO "messages" ("id", "role", "content") VALUES
                        ('10000000-0000-4000-8000-000000000001', 'user', 'question'),
                        ('10000000-0000-4000-8000-000000000002', 'assistant', 'legacy answer');
                `);

                await database.query(migration);

                const legacy = await database.query<{
                    execution_metadata: unknown;
                }>(`SELECT "execution_metadata" FROM "messages" ORDER BY "id"`);
                assert.deepEqual(legacy.rows, [
                    { execution_metadata: null },
                    { execution_metadata: null },
                ]);

                const metadata = {
                    modelId: "gpt-4o-mini",
                    generationDurationMs: 25,
                    totalLatencyMs: 40,
                    usage: {
                        inputTokens: 100,
                        cachedInputTokens: 0,
                        outputTokens: 20,
                        totalTokens: 120,
                    },
                    langfuseTraceId: null,
                };
                await database.query(
                    `UPDATE "messages" SET "execution_metadata" = $1::jsonb WHERE "role" = 'assistant'`,
                    [JSON.stringify(metadata)]
                );
                const stored = await database.query<{
                    execution_metadata: unknown;
                }>(
                    `SELECT "execution_metadata" FROM "messages" WHERE "role" = 'assistant'`
                );
                assert.deepEqual(stored.rows, [
                    { execution_metadata: metadata },
                ]);

                const column = await database.query<{
                    data_type: string;
                    is_nullable: string;
                }>(`
                    SELECT "data_type", "is_nullable"
                    FROM "information_schema"."columns"
                    WHERE "table_schema" = 'public'
                      AND "table_name" = 'messages'
                      AND "column_name" = 'execution_metadata'
                `);
                assert.deepEqual(column.rows, [
                    { data_type: "jsonb", is_nullable: "YES" },
                ]);
            }
        );
    }
);
