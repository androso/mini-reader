import {
    createBookProcessingQueue,
    enqueueProcessBookJob,
    type ProcessBookJobPayload,
} from "@reader/jobs";

let bookProcessingQueue: ReturnType<typeof createBookProcessingQueue> | null =
    null;

const getBookProcessingQueue = () => {
    if (!bookProcessingQueue) {
        bookProcessingQueue = createBookProcessingQueue();
        bookProcessingQueue.on("error", (error) => {
            console.error("[BookProcessingQueue] Redis/queue error:", error);
        });
    }

    return bookProcessingQueue;
};

export const enqueueBookProcessing = async (payload: ProcessBookJobPayload) =>
    enqueueProcessBookJob(getBookProcessingQueue(), payload);
