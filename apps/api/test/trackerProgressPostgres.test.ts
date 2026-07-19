import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.PROGRESS_MIGRATION_TEST_DATABASE_URL;

const quoteIdentifier = (identifier: string) =>
    `"${identifier.replace(/"/g, '""')}"`;

test(
    "concurrent progress upserts keep one row and the latest write",
    {
        skip: databaseUrl
            ? false
            : "requires PROGRESS_MIGRATION_TEST_DATABASE_URL",
    },
    async () => {
        assert.ok(databaseUrl);
        const adminUrl = new URL(databaseUrl);
        const databaseName = `reader_progress_upsert_${randomUUID().replace(/-/g, "")}`;
        const testUrl = new URL(adminUrl);
        testUrl.pathname = `/${databaseName}`;
        const admin = new Client({ connectionString: adminUrl.toString() });
        let databaseCreated = false;

        await admin.connect();
        try {
            await admin.query(
                `CREATE DATABASE ${quoteIdentifier(databaseName)}`
            );
            databaseCreated = true;
            const first = new Client({ connectionString: testUrl.toString() });
            const second = new Client({ connectionString: testUrl.toString() });
            await Promise.all([first.connect(), second.connect()]);

            try {
                await first.query(`
                    CREATE TABLE "progress" (
                        "user_id" uuid NOT NULL,
                        "book_id" uuid NOT NULL,
                        "progress_position" text NOT NULL,
                        "progress_chapter" text NOT NULL,
                        "created_at" timestamptz NOT NULL DEFAULT now(),
                        "updated_at" timestamptz NOT NULL DEFAULT now(),
                        CONSTRAINT "progress_user_id_book_id_pk"
                            PRIMARY KEY ("user_id", "book_id")
                    )
                `);
                const userId = "10000000-0000-4000-8000-000000000001";
                const bookId = "20000000-0000-4000-8000-000000000001";
                const upsert = `
                    INSERT INTO "progress" (
                        "user_id", "book_id", "progress_position", "progress_chapter"
                    ) VALUES ($1, $2, $3, $4)
                    ON CONFLICT ("user_id", "book_id") DO UPDATE SET
                        "progress_position" = excluded."progress_position",
                        "progress_chapter" = excluded."progress_chapter",
                        "updated_at" = now()
                `;

                await first.query("BEGIN");
                await first.query(upsert, [userId, bookId, "older", "c01"]);
                const laterWrite = second.query(upsert, [
                    userId,
                    bookId,
                    "latest",
                    "c02",
                ]);
                await first.query("COMMIT");
                await laterWrite;

                const rows = await second.query<{
                    progress_position: string;
                    progress_chapter: string;
                }>(
                    `SELECT "progress_position", "progress_chapter" FROM "progress" WHERE "user_id" = $1 AND "book_id" = $2`,
                    [userId, bookId]
                );
                assert.equal(rows.rowCount, 1);
                assert.deepEqual(rows.rows, [
                    { progress_position: "latest", progress_chapter: "c02" },
                ]);
            } finally {
                await Promise.all([first.end(), second.end()]);
            }
        } finally {
            if (databaseCreated) {
                await admin.query(
                    `SELECT pg_terminate_backend("pid") FROM "pg_stat_activity" WHERE "datname" = $1`,
                    [databaseName]
                );
                await admin.query(
                    `DROP DATABASE ${quoteIdentifier(databaseName)}`
                );
            }
            await admin.end();
        }
    }
);
