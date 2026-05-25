import type { ProcessBookJobPayload } from "@reader/jobs";
import type { ProcessBookInput, ProcessBookResult } from "@reader/processing";

export interface BookProcessingRecord {
    id: string;
    userId: string;
    fileKey: string;
    fileType: "epub" | "pdf" | null;
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
    ): Promise<{
        collectionName: string | null;
    } | null>;
    markReady(bookId: string, collectionName: string): Promise<void>;
    markFailed(bookId: string, error: string): Promise<void>;
}

export type ProcessBookForSearch = (
    input: ProcessBookInput
) => Promise<ProcessBookResult>;

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Book processing failed";

export const handleProcessBookJob = async (
    payload: ProcessBookJobPayload,
    repository: BookProcessingRepository,
    processBookForSearch: ProcessBookForSearch
) => {
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
        const result = await processBookForSearch({
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
