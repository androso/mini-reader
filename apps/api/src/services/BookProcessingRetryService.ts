import type { ProcessUploadedBookPayload } from "./BookProcessingService";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { Books } from "../db/schema";
import { handleBookProcessingEnqueue } from "./BookProcessingEnqueueService";

const RETRYABLE_STATUSES = ["queue_failed", "failed"];
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RetryableBook = {
    id: string;
    userId: string;
    fileKey: string;
    fileType: ProcessUploadedBookPayload["fileType"] | null;
    processingStatus: string;
};

export interface BookProcessingRetryRepository {
    findOwnedBook(
        bookId: string,
        userId: string
    ): Promise<RetryableBook | null>;
    claimRetry(bookId: string, userId: string): Promise<RetryableBook | null>;
}

export interface BookProcessingRetryDependencies {
    repository: BookProcessingRetryRepository;
    enqueue(payload: ProcessUploadedBookPayload): Promise<void>;
}

export class BookProcessingRetryNotFoundError extends Error {
    constructor() {
        super("Book was not found");
        this.name = "BookProcessingRetryNotFoundError";
    }
}

export class BookProcessingRetryConflictError extends Error {
    constructor() {
        super("Book is not retryable");
        this.name = "BookProcessingRetryConflictError";
    }
}

const selection = {
    id: Books.id,
    userId: Books.userId,
    fileKey: Books.fileKey,
    fileType: Books.fileType,
    processingStatus: Books.processingStatus,
};

const bookProcessingRetryRepository: BookProcessingRetryRepository = {
    async findOwnedBook(bookId, userId) {
        const [book] = await db
            .select(selection)
            .from(Books)
            .where(and(eq(Books.id, bookId), eq(Books.userId, userId)))
            .limit(1);
        return book ?? null;
    },

    async claimRetry(bookId, userId) {
        const [book] = await db
            .update(Books)
            .set({ processingStatus: "processing", processingError: null })
            .where(
                and(
                    eq(Books.id, bookId),
                    eq(Books.userId, userId),
                    inArray(Books.processingStatus, RETRYABLE_STATUSES),
                    isNotNull(Books.fileType)
                )
            )
            .returning(selection);
        return book ?? null;
    },
};

export const retryBookProcessing = async (
    bookId: string,
    userId: string,
    dependencies: BookProcessingRetryDependencies = {
        repository: bookProcessingRetryRepository,
        enqueue: handleBookProcessingEnqueue,
    }
) => {
    if (!UUID_PATTERN.test(bookId)) {
        throw new BookProcessingRetryNotFoundError();
    }

    const book = await dependencies.repository.findOwnedBook(bookId, userId);
    if (!book) {
        throw new BookProcessingRetryNotFoundError();
    }
    if (!book.fileType || !RETRYABLE_STATUSES.includes(book.processingStatus)) {
        throw new BookProcessingRetryConflictError();
    }

    const claimed = await dependencies.repository.claimRetry(bookId, userId);
    if (!claimed || !claimed.fileType) {
        throw new BookProcessingRetryConflictError();
    }

    await dependencies.enqueue({
        bookId: claimed.id,
        userId: claimed.userId,
        fileKey: claimed.fileKey,
        fileType: claimed.fileType,
    });

    return { bookId: claimed.id, status: "processing" as const };
};
