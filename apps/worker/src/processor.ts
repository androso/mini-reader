import type { Job } from "bullmq";
import type { BookProcessingJobData } from "@reader/jobs";
import type { ProcessBookResult } from "@reader/processing";

export type ProcessUploadedBook = (
    payload: BookProcessingJobData,
    options?: { markFailedOnError?: boolean }
) => Promise<ProcessBookResult>;

const loadProcessUploadedBook = (): ProcessUploadedBook => {
    const module = require("@reader/api/build/services/BookProcessingService");
    return module.processUploadedBook as ProcessUploadedBook;
};

export const processBookProcessingJob = async (
    job: Pick<Job<BookProcessingJobData>, "attemptsMade" | "data" | "opts">,
    processBook: ProcessUploadedBook = loadProcessUploadedBook()
) => {
    const maxAttempts =
        typeof job.opts.attempts === "number" && job.opts.attempts > 0
            ? job.opts.attempts
            : 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    await processBook(job.data, {
        markFailedOnError: isFinalAttempt,
    });
};
