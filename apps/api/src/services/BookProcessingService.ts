import { and, eq, ne } from "drizzle-orm";
import {
    processBookForSearch,
    type BookFileType,
    type ProcessBookResult,
} from "@reader/processing";
import { db } from "../db";
import { Books } from "../db/schema";

export interface ProcessUploadedBookPayload {
    bookId: string;
    userId: string;
    fileKey: string;
    fileType: BookFileType;
}

export interface BookProcessingRecord {
    id: string;
    userId: string;
    fileKey: string;
    fileType: BookFileType | null;
    collectionName: string | null;
    processingStatus: string;
    processingError: string | null;
}

export interface BookProcessingRepository {
    findBookForProcessing(
        bookId: string,
        userId: string
    ): Promise<BookProcessingRecord | null>;
    findReadyDuplicate(
        fileKey: string,
        excludeBookId: string
    ): Promise<{ collectionName: string | null } | null>;
    markReady(bookId: string, collectionName: string): Promise<void>;
    markFailed(bookId: string, error: string): Promise<void>;
}

export type ProcessBookForSearch = typeof processBookForSearch;

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Book processing failed";

const bookProcessingRepository: BookProcessingRepository = {
    async findBookForProcessing(bookId, userId) {
        const [book] = await db
            .select()
            .from(Books)
            .where(and(eq(Books.id, bookId), eq(Books.userId, userId)));
        return book ?? null;
    },

    async findReadyDuplicate(fileKey, excludeBookId) {
        const [duplicate] = await db
            .select({ collectionName: Books.collectionName })
            .from(Books)
            .where(
                and(
                    eq(Books.fileKey, fileKey),
                    ne(Books.id, excludeBookId),
                    eq(Books.processingStatus, "ready")
                )
            );

        return duplicate?.collectionName ? duplicate : null;
    },

    async markReady(bookId, collectionName) {
        await db
            .update(Books)
            .set({
                collectionName,
                processingStatus: "ready",
                processingError: null,
            })
            .where(eq(Books.id, bookId));
    },

    async markFailed(bookId, error) {
        await db
            .update(Books)
            .set({
                processingStatus: "failed",
                processingError: error,
            })
            .where(eq(Books.id, bookId));
    },
};

export const handleProcessUploadedBook = async (
    payload: ProcessUploadedBookPayload,
    repository: BookProcessingRepository,
    processBook: ProcessBookForSearch
): Promise<ProcessBookResult> => {
    try {
        const book = await repository.findBookForProcessing(
            payload.bookId,
            payload.userId
        );
        if (!book) {
            throw new Error(`Book ${payload.bookId} was not found`);
        }
        if (book.fileType !== payload.fileType) {
            throw new Error(
                `Book ${payload.bookId} file type changed from ${payload.fileType} to ${book.fileType}`
            );
        }

        const duplicate = await repository.findReadyDuplicate(
            payload.fileKey,
            payload.bookId
        );
        const result = await processBook({
            fileKey: payload.fileKey,
            fileType: payload.fileType,
            existingReadyCollectionName: duplicate?.collectionName ?? null,
            hasReadyBookForCollection: Boolean(duplicate?.collectionName),
        });

        await repository.markReady(payload.bookId, result.collectionName);
        return result;
    } catch (error) {
        await repository.markFailed(payload.bookId, getErrorMessage(error));
        throw error;
    }
};

export const processUploadedBook = async (
    payload: ProcessUploadedBookPayload
): Promise<ProcessBookResult> =>
    handleProcessUploadedBook(
        payload,
        bookProcessingRepository,
        processBookForSearch
    );
