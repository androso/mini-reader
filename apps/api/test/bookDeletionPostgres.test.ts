import assert from "node:assert/strict";
import test from "node:test";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";

test(
    "deletion persists its lifecycle gate and removes the real Postgres job",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_book_deletion",
            { migrate: true },
            async ({ url, client: database }) => {
                let pool: (typeof import("../src/db"))["pool"] | undefined;

                try {
                    const userId = "10000000-0000-4000-8000-000000000001";
                    const bookId = "20000000-0000-4000-8000-000000000001";
                    const fileKey = `users/${userId}/books/${bookId}/original`;
                    const collectionName =
                        "book_20000000_0000_4000_8000_000000000001";
                    await database.query(
                        `INSERT INTO "users" ("id", "email", "name") VALUES ($1, 'owner@example.test', 'Owner')`,
                        [userId]
                    );
                    await database.query(
                        `
                            INSERT INTO "books" (
                                "id", "title", "user_id", "file_key", "file_type",
                                "original_filename", "collection_name", "processing_status"
                            ) VALUES ($1, 'Queued book', $2, $3, 'epub', 'Queued book', $4, 'processing')
                        `,
                        [bookId, userId, fileKey, collectionName]
                    );
                    await database.query(
                        `
                            INSERT INTO "book_processing_jobs" (
                                "id", "book_id", "user_id", "file_key", "file_type"
                            ) VALUES ('job-1', $1, $2, $3, 'epub')
                        `,
                        [bookId, userId, fileKey]
                    );

                    process.env.DATABASE_URL = url;
                    const deletion = await import(
                        "../src/services/BookDeletionService"
                    );
                    const processing = await import(
                        "../src/services/BookProcessingService"
                    );
                    ({ pool } = await import("../src/db"));

                    let lifecycleChecked = false;
                    await deletion.deleteOwnedBook(bookId, userId, {
                        repository: deletion.bookDeletionRepository,
                        artifacts: {
                            deleteFile: async (deletedKey) => {
                                assert.equal(deletedKey, fileKey);
                                const state = await database.query<{
                                    processing_status: string;
                                    job_count: string;
                                }>(
                                    `
                                        SELECT
                                            "processing_status",
                                            (
                                                SELECT count(*)
                                                FROM "book_processing_jobs"
                                                WHERE "book_id" = $1
                                            )::text AS "job_count"
                                        FROM "books"
                                        WHERE "id" = $1
                                    `,
                                    [bookId]
                                );
                                assert.deepEqual(state.rows, [
                                    {
                                        processing_status: "deleting",
                                        job_count: "0",
                                    },
                                ]);

                                const published =
                                    await processing.bookProcessingRepository.markReady(
                                        bookId,
                                        userId,
                                        "late_collection",
                                        {
                                            title: null,
                                            creator: null,
                                            identifier: null,
                                        }
                                    );
                                assert.equal(published, false);
                                await processing.bookProcessingRepository.markFailed(
                                    bookId,
                                    "late failure"
                                );
                                const afterLateUpdates = await database.query<{
                                    processing_status: string;
                                    collection_name: string | null;
                                    processing_error: string | null;
                                }>(
                                    `
                                        SELECT
                                            "processing_status",
                                            "collection_name",
                                            "processing_error"
                                        FROM "books"
                                        WHERE "id" = $1
                                    `,
                                    [bookId]
                                );
                                assert.deepEqual(afterLateUpdates.rows, [
                                    {
                                        processing_status: "deleting",
                                        collection_name: collectionName,
                                        processing_error: null,
                                    },
                                ]);
                                lifecycleChecked = true;
                            },
                            deleteVectorCollection: async (
                                deletedCollection
                            ) => {
                                assert.equal(deletedCollection, collectionName);
                            },
                            deleteSearchChunks: async (deletedCollection) => {
                                assert.equal(deletedCollection, collectionName);
                            },
                            clearCollectionCache: (deletedCollection) => {
                                assert.equal(deletedCollection, collectionName);
                            },
                        },
                    });

                    assert.equal(lifecycleChecked, true);
                    const remaining = await database.query<{
                        book_count: string;
                        job_count: string;
                    }>(`
                        SELECT
                            (SELECT count(*) FROM "books")::text AS "book_count",
                            (SELECT count(*) FROM "book_processing_jobs")::text AS "job_count"
                    `);
                    assert.deepEqual(remaining.rows, [
                        { book_count: "0", job_count: "0" },
                    ]);
                } finally {
                    if (pool) await pool.end();
                }
            }
        );
    }
);
