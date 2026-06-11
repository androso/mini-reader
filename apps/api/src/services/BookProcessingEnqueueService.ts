import type { BookProcessingJobData } from "@reader/jobs";
import { eq, sql } from "drizzle-orm";
import { deleteFile } from "@reader/providers";
import { db } from "../db";
import { Books } from "../db/schema";
import { enqueueUploadedBookForProcessing } from "./BookProcessingQueue";

export interface BookProcessingEnqueueRepository {
    markQueueFailed(bookId: string, error: string): Promise<void>;
    countBooksWithFileKey(fileKey: string): Promise<number>;
}

export interface BookProcessingEnqueueStorage {
    deleteFile(fileKey: string): Promise<void>;
}

export interface BookProcessingEnqueueDependencies {
    enqueue(payload: BookProcessingJobData): Promise<void>;
    repository: BookProcessingEnqueueRepository;
    storage: BookProcessingEnqueueStorage;
    onCleanupError?(error: unknown): void;
}

export class BookProcessingQueueUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BookProcessingQueueUnavailableError";
    }
}

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Unknown error";

const bookProcessingEnqueueRepository: BookProcessingEnqueueRepository = {
    async markQueueFailed(bookId, error) {
        await db
            .update(Books)
            .set({
                processingStatus: "failed",
                processingError: `Book processing queue unavailable: ${error}`,
            })
            .where(eq(Books.id, bookId));
    },

    async countBooksWithFileKey(fileKey) {
        const [remaining] = await db
            .select({ count: sql`count(*)`.mapWith(Number) })
            .from(Books)
            .where(eq(Books.fileKey, fileKey));

        return remaining.count;
    },
};

export const handleBookProcessingEnqueue = async (
    payload: BookProcessingJobData,
    dependencies: BookProcessingEnqueueDependencies = {
        enqueue: enqueueUploadedBookForProcessing,
        repository: bookProcessingEnqueueRepository,
        storage: {
            deleteFile: async (fileKey) => {
                await deleteFile(fileKey);
            },
        },
        onCleanupError: (error) =>
            console.error("Uploaded file cleanup failed", error),
    }
) => {
    try {
        await dependencies.enqueue(payload);
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        await dependencies.repository.markQueueFailed(
            payload.bookId,
            errorMessage
        );

        try {
            const fileReferenceCount =
                await dependencies.repository.countBooksWithFileKey(
                    payload.fileKey
                );
            if (fileReferenceCount <= 1) {
                await dependencies.storage.deleteFile(payload.fileKey);
            }
        } catch (cleanupError) {
            dependencies.onCleanupError?.(cleanupError);
        }

        throw new BookProcessingQueueUnavailableError(errorMessage);
    }
};
