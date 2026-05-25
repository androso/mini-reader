import dotenv from "dotenv";
import { Worker } from "bullmq";
import {
    assertProcessBookJobPayload,
    BOOK_PROCESSING_QUEUE,
    createRedisConnection,
    PROCESS_BOOK_JOB,
} from "@reader/jobs";
import { processBookForSearch } from "@reader/processing";
import { bookProcessingRepository } from "./bookRepository";
import { handleProcessBookJob } from "./jobHandler";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "../../.env" });

const connection = createRedisConnection();

const worker = new Worker(
    BOOK_PROCESSING_QUEUE,
    async (job) => {
        if (job.name !== PROCESS_BOOK_JOB) {
            throw new Error(`Unsupported job: ${job.name}`);
        }

        return handleProcessBookJob(
            assertProcessBookJobPayload(job.data),
            bookProcessingRepository,
            processBookForSearch
        );
    },
    {
        connection,
        concurrency: Number(process.env.BOOK_PROCESSING_CONCURRENCY || 2),
    }
);

worker.on("completed", (job) => {
    console.log(`[worker] Completed ${job.name} ${job.id}`);
});

worker.on("failed", (job, error) => {
    console.error(`[worker] Failed ${job?.name} ${job?.id}`, error);
});

const shutdown = async () => {
    await worker.close();
    await connection.quit();
};

process.on("SIGINT", () => {
    shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
    shutdown().finally(() => process.exit(0));
});
