import type { BookProcessingJobData } from "@reader/jobs";
import { pool } from "../db";

const parsePositiveIntegerEnv = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
};

export const createBookProcessingJobId = (bookId: string) =>
    `book-processing-${bookId}`;

export const enqueueUploadedBookForProcessing = async (
    payload: BookProcessingJobData
) => {
    const maxAttempts = parsePositiveIntegerEnv(
        "BOOK_PROCESSING_MAX_ATTEMPTS",
        3
    );

    await pool.query(
        `
            INSERT INTO book_processing_jobs (
                id,
                book_id,
                user_id,
                file_key,
                file_type,
                status,
                attempts,
                max_attempts,
                available_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, 'queued', 0, $6, now(), now())
            ON CONFLICT (book_id) DO UPDATE
            SET
                file_key = EXCLUDED.file_key,
                file_type = EXCLUDED.file_type,
                status = 'queued',
                attempts = 0,
                max_attempts = EXCLUDED.max_attempts,
                last_error = null,
                available_at = now(),
                locked_at = null,
                completed_at = null,
                updated_at = now()
        `,
        [
            createBookProcessingJobId(payload.bookId),
            payload.bookId,
            payload.userId,
            payload.fileKey,
            payload.fileType,
            maxAttempts,
        ]
    );
};

export const closeBookProcessingQueue = async () => {
    await pool.end();
};
