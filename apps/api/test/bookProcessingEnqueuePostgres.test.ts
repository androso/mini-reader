import assert from "node:assert/strict";
import test from "node:test";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";

test(
    "default markQueueFailed persists queue_failed over Postgres when enqueue throws",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_enqueue_mark_failed",
            { migrate: true },
            async ({ url, client: database }) => {
                let pool: (typeof import("../src/db"))["pool"] | undefined;
                const userId = "10000000-0000-4000-8000-000000000031";
                const bookId = "20000000-0000-4000-8000-000000000031";
                const fileKey = `users/${userId}/books/${bookId}/original`;

                try {
                    process.env.DATABASE_URL = url;
                    await database.query(
                        `INSERT INTO "users" ("id", "email", "name") VALUES ($1, 'enqueue@example.test', 'Enqueue')`,
                        [userId]
                    );
                    await database.query(
                        `
                            INSERT INTO "books" (
                                "id", "title", "user_id", "file_key", "file_type",
                                "original_filename", "processing_status"
                            ) VALUES ($1, 'Queued', $2, $3, 'epub', 'queued.epub', 'processing')
                        `,
                        [bookId, userId, fileKey]
                    );

                    const {
                        handleBookProcessingEnqueue,
                        BookProcessingQueueUnavailableError,
                    } = await import(
                        "../src/services/BookProcessingEnqueueService"
                    );
                    ({ pool } = await import("../src/db"));

                    await assert.rejects(
                        handleBookProcessingEnqueue({
                            bookId,
                            userId,
                            fileKey,
                            fileType: "not-a-real-type" as "epub",
                        }),
                        BookProcessingQueueUnavailableError
                    );

                    const row = await database.query<{
                        processing_status: string;
                        processing_error: string | null;
                    }>(
                        `SELECT processing_status, processing_error FROM books WHERE id = $1`,
                        [bookId]
                    );
                    assert.equal(
                        row.rows[0]?.processing_status,
                        "queue_failed"
                    );
                    assert.match(
                        row.rows[0]?.processing_error ?? "",
                        /Book processing queue unavailable/
                    );
                } finally {
                    if (pool) await pool.end();
                }
            }
        );
    }
);
