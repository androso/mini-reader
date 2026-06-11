import type { Job } from "bullmq";
import type { BookProcessingJobData } from "@reader/jobs";
import type { ProcessBookResult } from "@reader/processing";

export type ProcessUploadedBook = (
    payload: BookProcessingJobData
) => Promise<ProcessBookResult>;

const loadProcessUploadedBook = (): ProcessUploadedBook => {
    const module = require("@reader/api/build/services/BookProcessingService");
    return module.processUploadedBook as ProcessUploadedBook;
};

export const processBookProcessingJob = async (
    job: Pick<Job<BookProcessingJobData>, "data">,
    processBook: ProcessUploadedBook = loadProcessUploadedBook()
) => {
    await processBook(job.data);
};
