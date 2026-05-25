import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import type { ProcessBookJobPayload } from "./types";

export const BOOK_PROCESSING_QUEUE = "book-processing";
export const PROCESS_BOOK_JOB = "process-book";

export const getRedisUrl = () =>
    process.env.REDIS_URL || "redis://localhost:6379";

export const createRedisConnection = () =>
    new IORedis(getRedisUrl(), {
        maxRetriesPerRequest: null,
    });

export const buildProcessBookJobOptions = (bookId: string): JobsOptions => ({
    jobId: bookId,
    attempts: 3,
    backoff: {
        type: "exponential",
        delay: 2000,
    },
    removeOnComplete: {
        age: 60 * 60 * 24,
        count: 1000,
    },
    removeOnFail: {
        age: 60 * 60 * 24 * 7,
        count: 5000,
    },
});

export const createBookProcessingQueue = (
    connection = createRedisConnection()
) => new Queue<ProcessBookJobPayload>(BOOK_PROCESSING_QUEUE, { connection });

export const enqueueProcessBookJob = async (
    queue: Queue<ProcessBookJobPayload>,
    payload: ProcessBookJobPayload
) =>
    queue.add(
        PROCESS_BOOK_JOB,
        payload,
        buildProcessBookJobOptions(payload.bookId)
    );

export const assertProcessBookJobPayload = (
    value: unknown
): ProcessBookJobPayload => {
    if (!value || typeof value !== "object") {
        throw new Error("Invalid process-book payload");
    }

    const payload = value as Partial<ProcessBookJobPayload>;
    if (
        typeof payload.bookId !== "string" ||
        typeof payload.userId !== "string" ||
        typeof payload.fileKey !== "string" ||
        (payload.fileType !== "epub" && payload.fileType !== "pdf")
    ) {
        throw new Error("Invalid process-book payload");
    }

    return payload as ProcessBookJobPayload;
};
