import {
    createBookProcessingQueue,
    enqueueProcessBookJob,
    type ProcessBookJobPayload,
} from "@reader/jobs";

const bookProcessingQueue = createBookProcessingQueue();

export const enqueueBookProcessing = async (payload: ProcessBookJobPayload) =>
    enqueueProcessBookJob(bookProcessingQueue, payload);
