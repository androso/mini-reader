export type BookProcessingRetryStatus = {
    fileType: "epub" | "pdf" | null;
    status: "processing" | "ready" | "queue_failed" | "failed";
};

export const canRetryBookProcessing = (
    processingStatus: BookProcessingRetryStatus | null | undefined
) =>
    (processingStatus?.fileType === "epub" ||
        processingStatus?.fileType === "pdf") &&
    (processingStatus.status === "failed" ||
        processingStatus.status === "queue_failed");
