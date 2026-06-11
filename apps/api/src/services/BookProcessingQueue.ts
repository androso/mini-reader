import {
    createBookProcessingQueue,
    enqueueBookProcessingJob,
    type BookProcessingJobData,
    type BookProcessingQueue,
} from "@reader/jobs";

let queue: BookProcessingQueue | null = null;

const getQueue = () => {
    if (!queue) {
        queue = createBookProcessingQueue();
    }
    return queue;
};

export const enqueueUploadedBookForProcessing = async (
    payload: BookProcessingJobData
) => {
    await enqueueBookProcessingJob(getQueue(), payload);
};

export const closeBookProcessingQueue = async () => {
    if (!queue) return;
    await queue.close();
    queue = null;
};
