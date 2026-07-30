import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import jwt from "jsonwebtoken";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";
import { withHttpServer } from "./support/http";

const EMBEDDING_DIMENSIONS = 1536;

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000002";
const BOOK_ID = "20000000-0000-4000-8000-000000000001";
const RETRY_BOOK_ID = "20000000-0000-4000-8000-000000000002";

const CHUNK_A =
    "Aurora borealis lights dance across the polar winter night sky";
const CHUNK_B = "Desert sand dunes shimmer under the harsh noon sun";
const FIXED_METADATA = {
    title: "Injected Processing Title",
    creator: "Fixture Author",
    identifier: "urn:test:book-processing-postgres",
} as const;

const PDF_BYTES = Buffer.from("%PDF-1.7\ninjected-fixture\n%%EOF\n");

const trustedOrigin = "http://localhost:3001";

const createDeterministicEmbedding = (text: string): number[] => {
    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const token of tokens) {
        let hash = 2166136261;
        for (let index = 0; index < token.length; index += 1) {
            hash ^= token.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        vector[(hash >>> 0) % EMBEDDING_DIMENSIONS] += 1;
    }
    const norm = Math.sqrt(
        vector.reduce((sum, value) => sum + value * value, 0)
    );
    if (norm === 0) {
        vector[0] = 1;
        return vector;
    }
    return vector.map((value) => value / norm);
};

const deterministicEmbed = async (input: string[]) =>
    input.map(createDeterministicEmbedding);

const behaviorTables = [
    "book_search_chunks",
    "book_processing_jobs",
    "reader_package_jobs",
    "reader_chapters",
    "reader_resources",
    "progress",
    "messages",
    "conversations",
    "books",
    "users",
] as const;

test(
    "book processing postgres orchestration persists ready books and retries queue_failed ownership",
    integrationTestOptions,
    async (t) => {
        await withTestDatabase(
            "reader_book_processing",
            { migrate: true },
            async ({ url, client: database }) => {
                const localStorageDir = await mkdtemp(
                    path.join(tmpdir(), "book-processing-postgres-")
                );
                let pool: (typeof import("../src/db"))["pool"] | undefined;

                try {
                    process.env.DATABASE_URL = url;
                    process.env.STORAGE_DRIVER = "local";
                    process.env.LOCAL_STORAGE_DIR = localStorageDir;
                    process.env.OPENAI_API_KEY ??= "test-openai-key";
                    process.env.JWT_SECRET ??=
                        "book-processing-postgres-test-secret";
                    process.env.FRONTEND_URL = trustedOrigin;
                    process.env.CODEX_OAUTH_ENABLED = "false";
                    process.env.BOOK_PROCESSING_RUNNER_ENABLED = "false";

                    const { pool: dbPool } = await import("../src/db");
                    pool = dbPool;

                    const {
                        bookProcessingRepository,
                        handleProcessUploadedBook,
                    } = await import("../src/services/BookProcessingService");
                    const { bookSearchChunkStore } = await import(
                        "../src/services/BookSearchChunkStore"
                    );
                    const { hybridBookSearchService } = await import(
                        "../src/services/HybridBookSearchService"
                    );
                    const { processNextBookProcessingWork } = await import(
                        "../src/services/BookProcessingRunner"
                    );
                    const { createBookProcessingJobId } = await import(
                        "../src/services/BookProcessingQueue"
                    );
                    const { ObjectStorageProvider, PgVectorStore } =
                        await import("@reader/providers");
                    const { processBookForSearch } = await import(
                        "@reader/processing"
                    );
                    const { default: app } = await import("../src/app");

                    const storage = new ObjectStorageProvider({
                        storageDriver: "local",
                        localStorageDir,
                    });
                    const vectorStore = new PgVectorStore({
                        pool: dbPool,
                        embed: deterministicEmbed,
                    });

                    const extractPdfBook = async () => ({
                        chunks: [CHUNK_A, CHUNK_B],
                        metadata: {
                            title: FIXED_METADATA.title,
                            creator: FIXED_METADATA.creator,
                            identifier: FIXED_METADATA.identifier,
                        },
                    });

                    const processUploadedBook = async (
                        payload: Parameters<
                            typeof handleProcessUploadedBook
                        >[0],
                        options: Parameters<
                            typeof handleProcessUploadedBook
                        >[3] = {}
                    ) => {
                        const result = await handleProcessUploadedBook(
                            payload,
                            bookProcessingRepository,
                            (input) =>
                                processBookForSearch(input, {
                                    storage,
                                    vectorStore,
                                    searchIndexStore: bookSearchChunkStore,
                                    extractPdfBook,
                                }),
                            options
                        );
                        hybridBookSearchService.clearCollectionCache(
                            result.collectionName
                        );
                        return result;
                    };

                    const processWork = () =>
                        processNextBookProcessingWork({
                            pool: dbPool,
                            processUploadedBook,
                            processNextReaderPackageJob: async () => false,
                        });

                    const truncateBehaviorTables = async () => {
                        await database.query(
                            `TRUNCATE TABLE ${behaviorTables
                                .map((table) => `"${table}"`)
                                .join(", ")} RESTART IDENTITY CASCADE`
                        );
                    };

                    const sessionCookieFor = (userId: string) => {
                        const token = jwt.sign(
                            { userId },
                            process.env.JWT_SECRET!
                        );
                        return `reader_session=${token}`;
                    };

                    const seedUser = async (
                        userId: string,
                        email: string,
                        name: string
                    ) => {
                        await database.query(
                            `INSERT INTO "users" ("id", "email", "name") VALUES ($1, $2, $3)`,
                            [userId, email, name]
                        );
                    };

                    const seedUploadedPdfBook = async (options: {
                        bookId: string;
                        userId: string;
                        processingStatus: string;
                        title: string;
                        withQueuedJob?: boolean;
                    }) => {
                        const fileKey = `users/${options.userId}/books/${options.bookId}/original`;
                        await storage.uploadFile(fileKey, PDF_BYTES);
                        await database.query(
                            `
                                INSERT INTO "books" (
                                    "id",
                                    "title",
                                    "user_id",
                                    "file_key",
                                    "file_type",
                                    "original_filename",
                                    "processing_status"
                                ) VALUES ($1, $2, $3, $4, 'pdf', $5, $6)
                            `,
                            [
                                options.bookId,
                                options.title,
                                options.userId,
                                fileKey,
                                `${options.title}.pdf`,
                                options.processingStatus,
                            ]
                        );
                        if (options.withQueuedJob) {
                            await database.query(
                                `
                                    INSERT INTO "book_processing_jobs" (
                                        "id",
                                        "book_id",
                                        "user_id",
                                        "file_key",
                                        "file_type",
                                        "status",
                                        "attempts",
                                        "max_attempts",
                                        "available_at",
                                        "updated_at"
                                    ) VALUES ($1, $2, $3, $4, 'pdf', 'queued', 0, 3, now(), now())
                                `,
                                [
                                    createBookProcessingJobId(options.bookId),
                                    options.bookId,
                                    options.userId,
                                    fileKey,
                                ]
                            );
                        }
                        return fileKey;
                    };

                    await t.test(
                        "processNextBookProcessingWork completes a seeded PDF job through injected extractor and embedder",
                        async () => {
                            await truncateBehaviorTables();
                            await seedUser(
                                OWNER_ID,
                                "owner@example.test",
                                "Owner"
                            );
                            const fileKey = await seedUploadedPdfBook({
                                bookId: BOOK_ID,
                                userId: OWNER_ID,
                                processingStatus: "processing",
                                title: "Queued PDF",
                                withQueuedJob: true,
                            });
                            const collectionName = `book_${BOOK_ID.replace(
                                /-/g,
                                "_"
                            )}`;

                            const workKind = await processWork();
                            assert.equal(workKind, "book");

                            const book = await database.query<{
                                processing_status: string;
                                collection_name: string | null;
                                title: string;
                                embedded_title: string | null;
                                creator: string | null;
                                identifier: string | null;
                                processing_error: string | null;
                            }>(
                                `
                                    SELECT
                                        "processing_status",
                                        "collection_name",
                                        "title",
                                        "embedded_title",
                                        "creator",
                                        "identifier",
                                        "processing_error"
                                    FROM "books"
                                    WHERE "id" = $1
                                `,
                                [BOOK_ID]
                            );
                            assert.deepEqual(book.rows, [
                                {
                                    processing_status: "ready",
                                    collection_name: collectionName,
                                    title: FIXED_METADATA.title,
                                    embedded_title: FIXED_METADATA.title,
                                    creator: FIXED_METADATA.creator,
                                    identifier: FIXED_METADATA.identifier,
                                    processing_error: null,
                                },
                            ]);

                            const job = await database.query<{
                                status: string;
                                last_error: string | null;
                            }>(
                                `
                                    SELECT "status", "last_error"
                                    FROM "book_processing_jobs"
                                    WHERE "book_id" = $1
                                `,
                                [BOOK_ID]
                            );
                            assert.equal(job.rowCount, 1);
                            assert.equal(job.rows[0]?.status, "completed");
                            assert.equal(job.rows[0]?.last_error, null);

                            const source = await storage.getFile(fileKey);
                            assert.deepEqual(source, PDF_BYTES);

                            const chunks = await database.query<{
                                chunk_index: number;
                                content: string;
                                embedding: string | null;
                            }>(
                                `
                                    SELECT
                                        "chunk_index",
                                        "content",
                                        "embedding"::text AS "embedding"
                                    FROM "book_search_chunks"
                                    WHERE "collection_name" = $1
                                    ORDER BY "chunk_index" ASC
                                `,
                                [collectionName]
                            );
                            assert.equal(chunks.rowCount, 2);
                            assert.deepEqual(
                                chunks.rows.map((row) => ({
                                    chunk_index: row.chunk_index,
                                    content: row.content,
                                    hasEmbedding: row.embedding !== null,
                                })),
                                [
                                    {
                                        chunk_index: 0,
                                        content: CHUNK_A,
                                        hasEmbedding: true,
                                    },
                                    {
                                        chunk_index: 1,
                                        content: CHUNK_B,
                                        hasEmbedding: true,
                                    },
                                ]
                            );

                            const searchResults =
                                await vectorStore.searchDocuments(
                                    collectionName,
                                    "aurora polar winter night",
                                    2
                                );
                            assert.equal(searchResults.length, 2);
                            assert.equal(searchResults[0]?.content, CHUNK_A);
                            assert.equal(searchResults[1]?.content, CHUNK_B);

                            const queried = await vectorStore.queryCollection(
                                collectionName,
                                "aurora polar winter night",
                                2
                            );
                            assert.deepEqual(queried.documents[0], [
                                CHUNK_A,
                                CHUNK_B,
                            ]);
                        }
                    );

                    await t.test(
                        "owned queue_failed retry queues work over HTTP and non-owners stay 404",
                        async () => {
                            await truncateBehaviorTables();
                            await seedUser(
                                OWNER_ID,
                                "owner@example.test",
                                "Owner"
                            );
                            await seedUser(
                                OTHER_USER_ID,
                                "other@example.test",
                                "Other"
                            );
                            const fileKey = await seedUploadedPdfBook({
                                bookId: RETRY_BOOK_ID,
                                userId: OWNER_ID,
                                processingStatus: "queue_failed",
                                title: "Retry PDF",
                            });
                            const collectionName = `book_${RETRY_BOOK_ID.replace(
                                /-/g,
                                "_"
                            )}`;

                            await withHttpServer(app, async (baseUrl) => {
                                const nonOwner = await fetch(
                                    `${baseUrl}/api/books/${RETRY_BOOK_ID}/retry`,
                                    {
                                        method: "POST",
                                        headers: {
                                            Origin: trustedOrigin,
                                            Cookie: sessionCookieFor(
                                                OTHER_USER_ID
                                            ),
                                        },
                                    }
                                );
                                assert.equal(nonOwner.status, 404);

                                const afterNonOwner = await database.query<{
                                    processing_status: string;
                                    job_count: string;
                                }>(
                                    `
                                        SELECT
                                            "processing_status",
                                            (
                                                SELECT count(*)::text
                                                FROM "book_processing_jobs"
                                                WHERE "book_id" = $1
                                            ) AS "job_count"
                                        FROM "books"
                                        WHERE "id" = $1
                                    `,
                                    [RETRY_BOOK_ID]
                                );
                                assert.deepEqual(afterNonOwner.rows, [
                                    {
                                        processing_status: "queue_failed",
                                        job_count: "0",
                                    },
                                ]);

                                const ownerRetry = await fetch(
                                    `${baseUrl}/api/books/${RETRY_BOOK_ID}/retry`,
                                    {
                                        method: "POST",
                                        headers: {
                                            Origin: trustedOrigin,
                                            Cookie: sessionCookieFor(OWNER_ID),
                                        },
                                    }
                                );
                                assert.equal(ownerRetry.status, 202);
                                assert.deepEqual(await ownerRetry.json(), {
                                    bookId: RETRY_BOOK_ID,
                                    status: "processing",
                                });

                                const queued = await database.query<{
                                    status: string;
                                    file_key: string;
                                    file_type: string;
                                }>(
                                    `
                                        SELECT "status", "file_key", "file_type"
                                        FROM "book_processing_jobs"
                                        WHERE "book_id" = $1
                                    `,
                                    [RETRY_BOOK_ID]
                                );
                                assert.equal(queued.rowCount, 1);
                                assert.deepEqual(queued.rows[0], {
                                    status: "queued",
                                    file_key: fileKey,
                                    file_type: "pdf",
                                });
                            });

                            const workKind = await processWork();
                            assert.equal(workKind, "book");

                            const book = await database.query<{
                                processing_status: string;
                                collection_name: string | null;
                                embedded_title: string | null;
                            }>(
                                `
                                    SELECT
                                        "processing_status",
                                        "collection_name",
                                        "embedded_title"
                                    FROM "books"
                                    WHERE "id" = $1
                                `,
                                [RETRY_BOOK_ID]
                            );
                            assert.deepEqual(book.rows, [
                                {
                                    processing_status: "ready",
                                    collection_name: collectionName,
                                    embedded_title: FIXED_METADATA.title,
                                },
                            ]);

                            const job = await database.query<{
                                status: string;
                            }>(
                                `
                                    SELECT "status"
                                    FROM "book_processing_jobs"
                                    WHERE "book_id" = $1
                                `,
                                [RETRY_BOOK_ID]
                            );
                            assert.equal(job.rows[0]?.status, "completed");
                        }
                    );
                } finally {
                    if (pool) await pool.end();
                    await rm(localStorageDir, {
                        recursive: true,
                        force: true,
                    });
                }
            }
        );
    }
);
