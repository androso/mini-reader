import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.BOOK_DELETION_TEST_DATABASE_URL;

const quoteIdentifier = (identifier: string) =>
    `"${identifier.replace(/"/g, '""')}"`;

test(
    "deletion persists its lifecycle gate and removes the real Postgres job",
    {
        skip: databaseUrl ? false : "requires BOOK_DELETION_TEST_DATABASE_URL",
    },
    async () => {
        assert.ok(databaseUrl);
        const adminUrl = new URL(databaseUrl);
        const databaseName = `reader_book_deletion_${randomUUID().replace(/-/g, "")}`;
        const testUrl = new URL(adminUrl);
        testUrl.pathname = `/${databaseName}`;
        const admin = new Client({ connectionString: adminUrl.toString() });
        let databaseCreated = false;
        let database: Client | undefined;
        let pool: (typeof import("../src/db"))["pool"] | undefined;

        await admin.connect();
        try {
            await admin.query(
                `CREATE DATABASE ${quoteIdentifier(databaseName)}`
            );
            databaseCreated = true;
            database = new Client({ connectionString: testUrl.toString() });
            await database.connect();
            await database.query(`
                CREATE TYPE "file_type" AS ENUM ('epub', 'pdf');
                CREATE TYPE "book_processing_job_status" AS ENUM (
                    'queued', 'processing', 'retrying', 'completed', 'failed'
                );
                CREATE TABLE "users" (
                    "id" uuid PRIMARY KEY,
                    "email" text NOT NULL UNIQUE,
                    "name" text NOT NULL,
                    "created_at" timestamp NOT NULL DEFAULT now(),
                    "updated_at" timestamp NOT NULL DEFAULT now()
                );
                CREATE TABLE "books" (
                    "id" uuid PRIMARY KEY,
                    "title" text NOT NULL,
                    "user_id" uuid NOT NULL REFERENCES "users"("id"),
                    "file_key" text NOT NULL,
                    "file_type" "file_type",
                    "collection_name" text,
                    "processing_status" text NOT NULL DEFAULT 'processing',
                    "processing_error" text,
                    "created_at" timestamp NOT NULL DEFAULT now()
                );
                CREATE TABLE "book_processing_jobs" (
                    "id" text PRIMARY KEY,
                    "book_id" uuid NOT NULL REFERENCES "books"("id") ON DELETE CASCADE,
                    "user_id" uuid NOT NULL,
                    "file_key" text NOT NULL,
                    "file_type" "file_type" NOT NULL,
                    "status" "book_processing_job_status" NOT NULL DEFAULT 'queued',
                    "attempts" integer NOT NULL DEFAULT 0,
                    "max_attempts" integer NOT NULL DEFAULT 3,
                    "last_error" text,
                    "available_at" timestamp NOT NULL DEFAULT now(),
                    "locked_at" timestamp,
                    "completed_at" timestamp,
                    "created_at" timestamp NOT NULL DEFAULT now(),
                    "updated_at" timestamp NOT NULL DEFAULT now()
                );
            `);

            const userId = "10000000-0000-4000-8000-000000000001";
            const bookId = "20000000-0000-4000-8000-000000000001";
            const fileKey = `users/${userId}/books/${bookId}/original`;
            const collectionName = "book_20000000_0000_4000_8000_000000000001";
            await database.query(
                `INSERT INTO "users" ("id", "email", "name") VALUES ($1, 'owner@example.test', 'Owner')`,
                [userId]
            );
            await database.query(
                `
                    INSERT INTO "books" (
                        "id", "title", "user_id", "file_key", "file_type",
                        "collection_name", "processing_status"
                    ) VALUES ($1, 'Queued book', $2, $3, 'epub', $4, 'processing')
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

            process.env.DATABASE_URL = testUrl.toString();
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
                        const state = await database!.query<{
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
                        const afterLateUpdates = await database!.query<{
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
                    deleteVectorCollection: async (deletedCollection) => {
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
            if (database) await database.end();
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
