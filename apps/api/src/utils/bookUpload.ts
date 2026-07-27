import { randomUUID } from "node:crypto";
import type { ProcessUploadedBookPayload } from "../services/BookProcessingService";

export const createOriginalUploadKey = (userId: string, bookId: string) =>
    `users/${userId}/books/${bookId}/original`;

export const createBookUploadPlan = (
    userId: string,
    originalFilename: string,
    fileType: ProcessUploadedBookPayload["fileType"],
    createId: () => string = randomUUID
) => {
    const bookId = createId();
    const fileKey = createOriginalUploadKey(userId, bookId);

    return {
        book: {
            id: bookId,
            title: originalFilename,
            originalFilename,
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
        } satisfies ProcessUploadedBookPayload,
    };
};
