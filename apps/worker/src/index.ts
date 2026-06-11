import { Worker } from "bullmq";
import {
    BOOK_PROCESSING_QUEUE_NAME,
    getRedisConnectionOptions,
    type BookProcessingJobData,
} from "@reader/jobs";
import { processBookProcessingJob } from "./processor";

const worker = new Worker<BookProcessingJobData>(
    BOOK_PROCESSING_QUEUE_NAME,
    (job) => processBookProcessingJob(job),
    {
        connection: getRedisConnectionOptions(),
    }
);

worker.on("completed", (job) => {
    console.log(`Book processing job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
    console.error(`Book processing job ${job?.id ?? "unknown"} failed`, error);
});

const shutdown = async () => {
    console.log("Shutting down book processing worker");
    await worker.close();
    process.exit(0);
};

process.on("SIGTERM", () => {
    void shutdown();
});

process.on("SIGINT", () => {
    void shutdown();
});

console.log(`Book processing worker listening on ${BOOK_PROCESSING_QUEUE_NAME}`);
