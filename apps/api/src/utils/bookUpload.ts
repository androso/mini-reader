import { randomUUID } from "node:crypto";
import type { BookProcessingJobData } from "@reader/jobs";

export const createOriginalUploadKey = (userId: string, bookId: string) =>
    `users/${userId}/books/${bookId}/original`;

export const createBookUploadPlan = (
    userId: string,
    title: string,
    fileType: BookProcessingJobData["fileType"],
    createId: () => string = randomUUID
) => {
    const bookId = createId();
    const fileKey = createOriginalUploadKey(userId, bookId);

    return {
        book: {
            id: bookId,
            title,
            userId,
            fileKey,
            fileType,
            processingStatus: "processing" as const,
            processingError: null,
        },
        job: {
            bookId,
            userId,
            fileKey,
            fileType,
        } satisfies BookProcessingJobData,
    };
};
