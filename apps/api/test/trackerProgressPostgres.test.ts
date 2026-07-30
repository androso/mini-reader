import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";

test(
    "concurrent progress upserts keep one row and the latest write",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_progress_upsert",
            { migrate: true },
            async ({ url, client: first }) => {
                const second = new Client({ connectionString: url });
                await second.connect();

                try {
                    const userId = "10000000-0000-4000-8000-000000000001";
                    const bookId = "20000000-0000-4000-8000-000000000001";
                    await first.query(
                        `INSERT INTO "users" ("id", "email", "name") VALUES ($1, 'owner@example.test', 'Owner')`,
                        [userId]
                    );
                    await first.query(
                        `
                            INSERT INTO "books" (
                                "id", "title", "user_id", "file_key", "original_filename"
                            ) VALUES ($1, 'Progress book', $2, 'progress-key', 'Progress book')
                        `,
                        [bookId, userId]
                    );

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
                        {
                            progress_position: "latest",
                            progress_chapter: "c02",
                        },
                    ]);
                } finally {
                    await second.end();
                }
            }
        );
    }
);
