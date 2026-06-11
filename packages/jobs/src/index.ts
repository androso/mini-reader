import { Queue, type JobsOptions, type QueueOptions } from "bullmq";

export const BOOK_PROCESSING_QUEUE_NAME = "book-processing";

export type BookFileType = "epub" | "pdf";

export interface BookProcessingJobData {
    bookId: string;
    userId: string;
    fileKey: string;
    fileType: BookFileType;
}

export type BookProcessingQueue = Queue<BookProcessingJobData>;

const defaultJobOptions: JobsOptions = {
    attempts: 3,
    backoff: {
        type: "exponential",
        delay: 5000,
    },
    removeOnComplete: {
        age: 24 * 60 * 60,
        count: 1000,
    },
    removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 5000,
    },
};

export const getRedisConnectionOptions = () => {
    if (!process.env.REDIS_URL) {
        throw new Error("Missing required REDIS_URL environment variable");
    }

    return {
        url: process.env.REDIS_URL,
        maxRetriesPerRequest: null,
    };
};

export const createBookProcessingQueue = (
    options: Omit<QueueOptions, "connection" | "defaultJobOptions"> = {}
) =>
    new Queue<BookProcessingJobData>(BOOK_PROCESSING_QUEUE_NAME, {
        ...options,
        connection: getRedisConnectionOptions(),
        defaultJobOptions,
    });

export const createBookProcessingJobId = (bookId: string) =>
    `book-processing:${bookId}`;

export const enqueueBookProcessingJob = async (
    queue: BookProcessingQueue,
    payload: BookProcessingJobData
) => {
    await queue.add("process-book", payload, {
        jobId: createBookProcessingJobId(payload.bookId),
    });
};
