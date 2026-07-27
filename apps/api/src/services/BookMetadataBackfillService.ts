import type { BookFileType, ExtractedBookMetadata } from "@reader/processing";

export interface BookMetadataBackfillRecord {
    id: string;
    userId: string;
    fileKey: string;
    fileType: BookFileType;
}

export interface BookMetadataBackfillDependencies {
    listBatch(
        afterId: string | null,
        limit: number
    ): Promise<BookMetadataBackfillRecord[]>;
    getFile(fileKey: string): Promise<Buffer>;
    extractMetadata(
        fileBuffer: Buffer,
        fileType: BookFileType
    ): Promise<ExtractedBookMetadata>;
    markExtracted(
        book: BookMetadataBackfillRecord,
        metadata: ExtractedBookMetadata
    ): Promise<boolean>;
    onBookFailure?(bookId: string, error: unknown): void;
}

export interface BookMetadataBackfillResult {
    processed: number;
    updated: number;
    failed: number;
}

const BATCH_SIZE = 50;

export const backfillBookMetadata = async (
    dependencies: BookMetadataBackfillDependencies
): Promise<BookMetadataBackfillResult> => {
    const result: BookMetadataBackfillResult = {
        processed: 0,
        updated: 0,
        failed: 0,
    };
    let afterId: string | null = null;

    while (true) {
        const books = await dependencies.listBatch(afterId, BATCH_SIZE);
        if (books.length === 0) {
            return result;
        }

        for (const book of books) {
            result.processed++;
            afterId = book.id;
            try {
                const file = await dependencies.getFile(book.fileKey);
                const metadata = await dependencies.extractMetadata(
                    file,
                    book.fileType
                );
                if (await dependencies.markExtracted(book, metadata)) {
                    result.updated++;
                }
            } catch (error) {
                result.failed++;
                dependencies.onBookFailure?.(book.id, error);
            }
        }

        if (books.length < BATCH_SIZE) {
            return result;
        }
    }
};
