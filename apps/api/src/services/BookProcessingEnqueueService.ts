import type { BookProcessingJobData } from "@reader/jobs";
import { eq, sql } from "drizzle-orm";
import { createLogger, deleteFile } from "@reader/providers";
import { db } from "../db";
import { Books } from "../db/schema";
import { enqueueUploadedBookForProcessing } from "./BookProcessingQueue";

const log = createLogger("BookProcessingEnqueueService");

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
        log.error("Marking book queue failed", { bookId, error });
        await db
            .update(Books)
            .set({
                processingStatus: "failed",
                processingError: `Book processing queue unavailable: ${error}`,
            })
            .where(eq(Books.id, bookId));
        log.error("Book queue marked failed", { bookId, error });
    },

    async countBooksWithFileKey(fileKey) {
        log.debug("Counting books with file key", { fileKey });
        const [remaining] = await db
            .select({ count: sql`count(*)`.mapWith(Number) })
            .from(Books)
            .where(eq(Books.fileKey, fileKey));
        log.debug("Books with file key counted", {
            fileKey,
            count: remaining.count,
        });
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
            log.error("Uploaded file cleanup failed", {
                error: getErrorMessage(error),
            }),
    }
) => {
    log.info("Enqueuing book for processing", {
        bookId: payload.bookId,
        userId: payload.userId,
        fileKey: payload.fileKey,
        fileType: payload.fileType,
    });
    try {
        await dependencies.enqueue(payload);
        log.info("Book enqueued successfully", { bookId: payload.bookId });
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        log.error("Failed to enqueue book", {
            bookId: payload.bookId,
            error: errorMessage,
        });
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
                log.info("Deleting orphaned uploaded file", {
                    fileKey: payload.fileKey,
                    fileReferenceCount,
                });
                await dependencies.storage.deleteFile(payload.fileKey);
            } else {
                log.debug("Skipping uploaded file cleanup, references remain", {
                    fileKey: payload.fileKey,
                    fileReferenceCount,
                });
            }
        } catch (cleanupError) {
            dependencies.onCleanupError?.(cleanupError);
        }

        throw new BookProcessingQueueUnavailableError(errorMessage);
    }
};
