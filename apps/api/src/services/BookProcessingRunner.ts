import { createLogger } from "@reader/providers";
import type { Pool } from "pg";
import { pool } from "../db";
import {
    processUploadedBook,
    type ProcessUploadedBookPayload,
} from "./BookProcessingService";
import { processNextReaderPackageJob } from "./ReaderPackageService";

const log = createLogger("BookProcessingRunner");

export type BookProcessingWorkDependencies = {
    pool: Pool;
    processUploadedBook: typeof processUploadedBook;
    processNextReaderPackageJob: typeof processNextReaderPackageJob;
};

const defaultBookProcessingWorkDependencies: BookProcessingWorkDependencies = {
    pool,
    processUploadedBook,
    processNextReaderPackageJob,
};

interface ClaimedBookProcessingJob extends ProcessUploadedBookPayload {
    id: string;
    attemptsMade: number;
    maxAttempts: number;
}

const parsePositiveIntegerEnv = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
};

const sleep = (delayMs: number) =>
    new Promise((resolve) => setTimeout(resolve, delayMs));

export const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        const nestedErrors = (error as Error & { errors?: unknown[] }).errors;
        if (Array.isArray(nestedErrors)) {
            const nestedMessages = nestedErrors
                .map(getErrorMessage)
                .filter((message) => message.length > 0);
            if (nestedMessages.length > 0) return nestedMessages.join("; ");
        }

        return error.message || error.name || "Book processing failed";
    }

    const message = String(error);
    return message || "Book processing failed";
};

const STALE_LOCK_ERROR = "Book processing lock expired";

export const shouldMarkBookFailed = (
    attemptsMade: number,
    maxAttempts: number
) => attemptsMade >= maxAttempts;

export const getRetryDelaySeconds = (
    attemptsMade: number,
    baseDelayMs: number
) => Math.ceil((baseDelayMs * 2 ** Math.max(attemptsMade - 1, 0)) / 1000);

export const getStaleLockSeconds = (staleLockMs: number) =>
    Math.ceil(staleLockMs / 1000);

const reclaimStaleProcessingJobs = async (dbPool: Pool) => {
    const staleLockMs = parsePositiveIntegerEnv(
        "BOOK_PROCESSING_STALE_LOCK_MS",
        15 * 60 * 1000
    );
    const staleLockSeconds = getStaleLockSeconds(staleLockMs);

    const failed = await dbPool.query<{ id: string }>(
        `
            WITH stale_jobs AS (
                UPDATE book_processing_jobs
                SET
                    status = 'failed',
                    last_error = $2,
                    locked_at = null,
                    updated_at = now()
                WHERE status = 'processing'
                  AND locked_at IS NOT NULL
                  AND locked_at < now() - ($1 * interval '1 second')
                  AND attempts >= max_attempts
                RETURNING book_id
            )
            UPDATE books
            SET
                processing_status = 'failed',
                processing_error = $2
            WHERE id IN (SELECT book_id FROM stale_jobs)
              AND processing_status = 'processing'
            RETURNING id
        `,
        [staleLockSeconds, STALE_LOCK_ERROR]
    );

    const retrying = await dbPool.query<{ id: string }>(
        `
            UPDATE book_processing_jobs
            SET
                status = 'retrying',
                last_error = $2,
                available_at = now(),
                locked_at = null,
                updated_at = now()
            WHERE status = 'processing'
              AND locked_at IS NOT NULL
              AND locked_at < now() - ($1 * interval '1 second')
              AND attempts < max_attempts
            RETURNING id
        `,
        [staleLockSeconds, `${STALE_LOCK_ERROR}; retrying`]
    );

    if (failed.rowCount || retrying.rowCount) {
        log.warn("Reclaimed stale Postgres book jobs", {
            failedCount: failed.rowCount,
            retryingCount: retrying.rowCount,
            staleLockSeconds,
        });
    }
};

const claimNextJob = async (
    dbPool: Pool
): Promise<ClaimedBookProcessingJob | null> => {
    const client = await dbPool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query<{
            id: string;
            book_id: string;
            user_id: string;
            file_key: string;
            file_type: "epub" | "pdf";
            attempts: number;
            max_attempts: number;
        }>(
            `
                SELECT
                    id,
                    book_id,
                    user_id,
                    file_key,
                    file_type,
                    attempts,
                    max_attempts
                FROM book_processing_jobs
                WHERE status IN ('queued', 'retrying')
                  AND available_at <= now()
                ORDER BY available_at ASC, created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            `
        );

        const job = result.rows[0];
        if (!job) {
            await client.query("COMMIT");
            return null;
        }

        const attemptsMade = job.attempts + 1;
        await client.query(
            `
                UPDATE book_processing_jobs
                SET
                    status = 'processing',
                    attempts = $2,
                    locked_at = now(),
                    updated_at = now()
                WHERE id = $1
            `,
            [job.id, attemptsMade]
        );
        await client.query("COMMIT");

        return {
            id: job.id,
            bookId: job.book_id,
            userId: job.user_id,
            fileKey: job.file_key,
            fileType: job.file_type,
            attemptsMade,
            maxAttempts: job.max_attempts,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const markJobCompleted = async (dbPool: Pool, jobId: string) => {
    await dbPool.query(
        `
            UPDATE book_processing_jobs
            SET
                status = 'completed',
                last_error = null,
                completed_at = now(),
                locked_at = null,
                updated_at = now()
            WHERE id = $1
        `,
        [jobId]
    );
};

const markJobRetrying = async (
    dbPool: Pool,
    job: ClaimedBookProcessingJob,
    error: string
) => {
    const baseDelayMs = parsePositiveIntegerEnv(
        "BOOK_PROCESSING_RETRY_DELAY_MS",
        5000
    );
    const delaySeconds = getRetryDelaySeconds(job.attemptsMade, baseDelayMs);

    await dbPool.query(
        `
            UPDATE book_processing_jobs
            SET
                status = 'retrying',
                last_error = $2,
                available_at = now() + ($3 * interval '1 second'),
                locked_at = null,
                updated_at = now()
            WHERE id = $1
        `,
        [job.id, error, delaySeconds]
    );
};

const markJobFailed = async (dbPool: Pool, jobId: string, error: string) => {
    await dbPool.query(
        `
            UPDATE book_processing_jobs
            SET
                status = 'failed',
                last_error = $2,
                locked_at = null,
                updated_at = now()
            WHERE id = $1
        `,
        [jobId, error]
    );
};

export const processNextBookProcessingWork = async (
    dependencies: BookProcessingWorkDependencies = defaultBookProcessingWorkDependencies
): Promise<"book" | "reader-package" | "idle"> => {
    await reclaimStaleProcessingJobs(dependencies.pool);
    const job = await claimNextJob(dependencies.pool);
    if (!job) {
        const processed = await dependencies.processNextReaderPackageJob();
        return processed ? "reader-package" : "idle";
    }

    const isFinalAttempt = shouldMarkBookFailed(
        job.attemptsMade,
        job.maxAttempts
    );
    log.info("Processing Postgres book job", {
        jobId: job.id,
        bookId: job.bookId,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.maxAttempts,
        isFinalAttempt,
    });

    try {
        await dependencies.processUploadedBook(job, {
            markFailedOnError: isFinalAttempt,
        });
        await markJobCompleted(dependencies.pool, job.id);
    } catch (error) {
        const message = getErrorMessage(error);
        if (isFinalAttempt) {
            await markJobFailed(dependencies.pool, job.id, message);
        } else {
            await markJobRetrying(dependencies.pool, job, message);
        }
        log.error("Postgres book job failed", {
            jobId: job.id,
            bookId: job.bookId,
            attemptsMade: job.attemptsMade,
            maxAttempts: job.maxAttempts,
            isFinalAttempt,
            error: message,
        });
    }

    return "book";
};

class BookProcessingRunner {
    private isStarted = false;
    private isStopping = false;
    private isTicking = false;
    private timer: NodeJS.Timeout | null = null;

    start() {
        if (this.isStarted) return;
        this.isStarted = true;
        this.isStopping = false;
        log.info("Starting Postgres book processing runner");
        this.schedule(0);
    }

    async stop() {
        this.isStopping = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        while (this.isTicking) {
            await sleep(100);
        }

        this.isStarted = false;
        log.info("Stopped Postgres book processing runner");
    }

    private schedule(delayMs?: number) {
        if (this.isStopping) return;
        const pollMs = parsePositiveIntegerEnv(
            "BOOK_PROCESSING_POLL_INTERVAL_MS",
            2000
        );
        this.timer = setTimeout(() => {
            void this.tick();
        }, delayMs ?? pollMs);
        this.timer.unref();
    }

    private async tick() {
        if (this.isTicking || this.isStopping) {
            this.schedule();
            return;
        }

        this.isTicking = true;
        try {
            await processNextBookProcessingWork();
        } catch (error) {
            log.error("Book processing runner tick failed", {
                error: getErrorMessage(error),
            });
        } finally {
            this.isTicking = false;
            this.schedule();
        }
    }
}

const runner = new BookProcessingRunner();

export const startBookProcessingRunner = () => {
    if (process.env.BOOK_PROCESSING_RUNNER_ENABLED === "false") {
        log.info("Book processing runner disabled by env");
        return;
    }

    runner.start();
};

export const stopBookProcessingRunner = () => runner.stop();
