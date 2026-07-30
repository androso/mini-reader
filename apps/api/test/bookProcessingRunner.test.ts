import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
    getStaleLockSeconds,
    getErrorMessage,
    getRetryDelaySeconds,
    processNextBookProcessingWork,
    shouldMarkBookFailed,
    startBookProcessingRunner,
    stopBookProcessingRunner,
    type BookProcessingWorkDependencies,
} from "../src/services/BookProcessingRunner";
import type { ProcessUploadedBookPayload } from "../src/services/BookProcessingService";

test("runner marks book failed only on the final attempt", () => {
    assert.equal(shouldMarkBookFailed(1, 3), false);
    assert.equal(shouldMarkBookFailed(2, 3), false);
    assert.equal(shouldMarkBookFailed(3, 3), true);
    assert.equal(shouldMarkBookFailed(4, 3), true);
});

test("runner retry delay uses exponential backoff in seconds", () => {
    assert.equal(getRetryDelaySeconds(1, 5000), 5);
    assert.equal(getRetryDelaySeconds(2, 5000), 10);
    assert.equal(getRetryDelaySeconds(3, 5000), 20);
});

test("runner stale lock delay rounds up to seconds", () => {
    assert.equal(getStaleLockSeconds(1), 1);
    assert.equal(getStaleLockSeconds(1000), 1);
    assert.equal(getStaleLockSeconds(1001), 2);
});

test("runner reports nested connection errors from AggregateError", () => {
    const first = Object.assign(new Error("connect ECONNREFUSED ::1:5432"), {
        code: "ECONNREFUSED",
    });
    const second = new Error("connect ECONNREFUSED 127.0.0.1:5432");

    assert.equal(
        getErrorMessage(
            Object.assign(new Error(""), {
                name: "AggregateError",
                errors: [first, second],
            })
        ),
        "connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432"
    );
    assert.equal(getErrorMessage(new Error("")), "Error");
});

test("stale-lock and processing failure updates cannot overwrite deleting", () => {
    const runnerSource = readFileSync(
        "src/services/BookProcessingRunner.ts",
        "utf8"
    );
    const processingSource = readFileSync(
        "src/services/BookProcessingService.ts",
        "utf8"
    );
    const enqueueSource = readFileSync(
        "src/services/BookProcessingEnqueueService.ts",
        "utf8"
    );

    assert.match(
        runnerSource,
        /UPDATE books[\s\S]*?WHERE id IN \(SELECT book_id FROM stale_jobs\)[\s\S]*?AND processing_status = 'processing'/
    );
    assert.match(
        processingSource,
        /processingStatus, "processing"\)[\s\S]*?\.returning\(\{ id: Books\.id \}\)/
    );
    assert.match(enqueueSource, /eq\(Books\.processingStatus, "processing"\)/);
});

test("tick delegates work to processNextBookProcessingWork", () => {
    const runnerSource = readFileSync(
        "src/services/BookProcessingRunner.ts",
        "utf8"
    );
    assert.match(
        runnerSource,
        /private async tick\(\)[\s\S]*?await processNextBookProcessingWork\(\)/
    );
    assert.match(
        runnerSource,
        /export const processNextBookProcessingWork = async/
    );
});

const emptyResult = <T extends Record<string, unknown>>(
    rows: T[] = []
): QueryResult<T> =>
    ({
        rows,
        rowCount: rows.length,
        command: "SELECT",
        oid: 0,
        fields: [],
    }) as QueryResult<T>;

const createMockPool = (options: {
    claimedJob?: {
        id: string;
        book_id: string;
        user_id: string;
        file_key: string;
        file_type: "epub" | "pdf";
        attempts: number;
        max_attempts: number;
    } | null;
}) => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const clientQueries: Array<{ sql: string; params: unknown[] }> = [];

    const client = {
        query: async (sql: string, params: unknown[] = []) => {
            clientQueries.push({ sql, params });
            if (/^BEGIN$/i.test(sql.trim()) || /^COMMIT$/i.test(sql.trim())) {
                return emptyResult();
            }
            if (/FOR UPDATE SKIP LOCKED/i.test(sql)) {
                return emptyResult(
                    options.claimedJob ? [options.claimedJob] : []
                );
            }
            return emptyResult();
        },
        release: () => undefined,
    } as unknown as PoolClient;

    const dbPool = {
        query: async (sql: string, params: unknown[] = []) => {
            queries.push({ sql, params });
            return emptyResult();
        },
        connect: async () => client,
    } as unknown as Pool;

    return { dbPool, queries, clientQueries };
};

const jobRow = {
    id: "job-1",
    book_id: "book-1",
    user_id: "user-1",
    file_key: "users/user-1/books/book-1/original",
    file_type: "epub" as const,
    attempts: 0,
    max_attempts: 3,
};

test("processNextBookProcessingWork returns book when a job is claimed and succeeds", async () => {
    const { dbPool, queries } = createMockPool({ claimedJob: jobRow });
    let processed: ProcessUploadedBookPayload | null = null;
    let readerCalls = 0;

    const result = await processNextBookProcessingWork({
        pool: dbPool,
        processUploadedBook: async (payload) => {
            processed = payload;
            return { bookId: payload.bookId } as never;
        },
        processNextReaderPackageJob: async () => {
            readerCalls += 1;
            return false;
        },
    });

    assert.equal(result, "book");
    assert.equal(readerCalls, 0);
    assert.deepEqual(processed, {
        id: "job-1",
        bookId: "book-1",
        userId: "user-1",
        fileKey: "users/user-1/books/book-1/original",
        fileType: "epub",
        attemptsMade: 1,
        maxAttempts: 3,
    });
    assert.ok(
        queries.some((query) =>
            /status = 'completed'/i.test(query.sql.replace(/\s+/g, " "))
        )
    );
});

test("processNextBookProcessingWork returns book when claimed job processing fails", async () => {
    const { dbPool, queries } = createMockPool({ claimedJob: jobRow });
    let readerCalls = 0;

    const result = await processNextBookProcessingWork({
        pool: dbPool,
        processUploadedBook: async () => {
            throw new Error("parse failed");
        },
        processNextReaderPackageJob: async () => {
            readerCalls += 1;
            return true;
        },
    });

    assert.equal(result, "book");
    assert.equal(readerCalls, 0);
    assert.ok(
        queries.some((query) =>
            /status = 'retrying'/i.test(query.sql.replace(/\s+/g, " "))
        )
    );
});

test("processNextBookProcessingWork returns reader-package when reader job ran", async () => {
    const { dbPool } = createMockPool({ claimedJob: null });
    let bookCalls = 0;

    const result = await processNextBookProcessingWork({
        pool: dbPool,
        processUploadedBook: async () => {
            bookCalls += 1;
            return { bookId: "unused" } as never;
        },
        processNextReaderPackageJob: async () => true,
    });

    assert.equal(result, "reader-package");
    assert.equal(bookCalls, 0);
});

test("processNextBookProcessingWork returns idle when neither queue has work", async () => {
    const { dbPool } = createMockPool({ claimedJob: null });

    const result = await processNextBookProcessingWork({
        pool: dbPool,
        processUploadedBook: async () => {
            throw new Error("should not process books when idle");
        },
        processNextReaderPackageJob: async () => false,
    });

    assert.equal(result, "idle");
});

test("processNextBookProcessingWork uses dependencies.pool for reclaim and status updates", async () => {
    const { dbPool, queries, clientQueries } = createMockPool({
        claimedJob: {
            ...jobRow,
            attempts: 2,
            max_attempts: 3,
        },
    });

    await processNextBookProcessingWork({
        pool: dbPool,
        processUploadedBook: async () => {
            throw new Error("final failure");
        },
        processNextReaderPackageJob: async () => false,
    } satisfies BookProcessingWorkDependencies);

    assert.ok(
        queries.some((query) => /stale_jobs/i.test(query.sql)),
        "reclaim SQL should use dependencies.pool"
    );
    assert.ok(
        clientQueries.some((query) =>
            /FOR UPDATE SKIP LOCKED/i.test(query.sql)
        ),
        "claim SQL should use dependencies.pool.connect()"
    );
    assert.ok(
        queries.some((query) =>
            /status = 'failed'/i.test(query.sql.replace(/\s+/g, " "))
        ),
        "fail SQL should use dependencies.pool"
    );
});

test("start/stop runner lifecycle honors disable flag and drains in-flight ticks", async () => {
    const previousEnabled = process.env.BOOK_PROCESSING_RUNNER_ENABLED;
    const previousPoll = process.env.BOOK_PROCESSING_POLL_INTERVAL_MS;
    process.env.DATABASE_URL ??=
        "postgresql://postgres:postgres@127.0.0.1:5432/reader_dev";
    process.env.BOOK_PROCESSING_POLL_INTERVAL_MS = "60000";

    try {
        process.env.BOOK_PROCESSING_RUNNER_ENABLED = "false";
        startBookProcessingRunner();

        delete process.env.BOOK_PROCESSING_RUNNER_ENABLED;
        startBookProcessingRunner();
        startBookProcessingRunner();
        await stopBookProcessingRunner();
        await stopBookProcessingRunner();
    } finally {
        if (previousEnabled === undefined) {
            delete process.env.BOOK_PROCESSING_RUNNER_ENABLED;
        } else {
            process.env.BOOK_PROCESSING_RUNNER_ENABLED = previousEnabled;
        }
        if (previousPoll === undefined) {
            delete process.env.BOOK_PROCESSING_POLL_INTERVAL_MS;
        } else {
            process.env.BOOK_PROCESSING_POLL_INTERVAL_MS = previousPoll;
        }
    }
});
