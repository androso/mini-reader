import type { StorageProvider, VectorStoreProvider } from "@reader/providers";
import { storageProvider, vectorStore, createLogger } from "@reader/providers";
import { extractEpubBook, extractEpubMetadata } from "./epubIngestion";
import { extractPdfBook, extractPdfMetadata } from "./pdfIngestion";

const log = createLogger("bookProcessing");

export type BookFileType = "epub" | "pdf";
export interface ExtractedBookMetadata {
    title: string | null;
    creator: string | null;
    identifier: string | null;
}

export interface ExtractedBookContent {
    chunks: string[];
    metadata: ExtractedBookMetadata;
}

export const normalizeBookMetadataValue = (value: unknown): string | null => {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
    return normalized || null;
};

export interface ProcessBookInput {
    bookId: string;
    fileKey: string;
    fileType: BookFileType;
}

export interface ProcessBookDependencies {
    storage: StorageProvider;
    vectorStore: VectorStoreProvider;
    searchIndexStore?: SearchIndexStore;
    extractEpubBook?: (fileBuffer: Buffer) => Promise<ExtractedBookContent>;
    extractPdfBook?: (fileBuffer: Buffer) => Promise<ExtractedBookContent>;
}

export interface SearchIndexStore {
    replaceCollectionChunks(
        collectionName: string,
        chunks: string[]
    ): Promise<void>;
}

export interface ProcessBookResult {
    collectionName: string;
    chunks: number;
    reusedCollection: boolean;
    metadata: ExtractedBookMetadata;
}

export const createBookCollectionName = (bookId: string) =>
    `book_${bookId.replace(/-/g, "_")}`;

export const processBookForSearch = async (
    input: ProcessBookInput,
    dependencies: ProcessBookDependencies = {
        storage: storageProvider,
        vectorStore,
    }
): Promise<ProcessBookResult> => {
    const start = Date.now();
    log.info("Starting book processing", {
        bookId: input.bookId,
        fileKey: input.fileKey,
        fileType: input.fileType,
    });

    log.info("Fetching file from storage", {
        fileKey: input.fileKey,
        fileType: input.fileType,
    });
    const fileBuffer = await dependencies.storage.getFile(input.fileKey);
    log.info("File fetched from storage", {
        fileKey: input.fileKey,
        fileSizeBytes: fileBuffer.length,
        fileType: input.fileType,
    });

    const epubExtractor = dependencies.extractEpubBook ?? extractEpubBook;
    const pdfExtractor = dependencies.extractPdfBook ?? extractPdfBook;

    log.info("Generating collection name", {
        fileKey: input.fileKey,
        fileType: input.fileType,
    });
    const collectionName = createBookCollectionName(input.bookId);
    log.info("Collection name generated", {
        fileKey: input.fileKey,
        collectionName,
    });

    log.info("Resetting collection before ingestion", {
        collectionName,
        bookId: input.bookId,
        fileKey: input.fileKey,
    });
    await dependencies.vectorStore.resetCollection(collectionName);
    await dependencies.searchIndexStore?.replaceCollectionChunks(
        collectionName,
        []
    );

    log.info("Extracting text chunks", {
        fileKey: input.fileKey,
        fileType: input.fileType,
        collectionName,
    });
    const content =
        input.fileType === "pdf"
            ? await pdfExtractor(fileBuffer)
            : await epubExtractor(fileBuffer);
    const { chunks } = content;
    log.info("Text chunks extracted", {
        fileKey: input.fileKey,
        collectionName,
        chunkCount: chunks.length,
        firstChunkLength: chunks[0]?.length,
        lastChunkLength: chunks[chunks.length - 1]?.length,
    });

    if (!chunks.length) {
        log.error("No valid text chunks extracted", {
            fileKey: input.fileKey,
            fileType: input.fileType,
        });
        throw new Error("No valid text chunks extracted");
    }

    log.info("Storing chunks in search index", {
        collectionName,
        chunkCount: chunks.length,
    });
    await dependencies.searchIndexStore?.replaceCollectionChunks(
        collectionName,
        chunks
    );
    log.info("Search index chunks stored", {
        collectionName,
        chunkCount: chunks.length,
    });

    log.info("Adding chunks to vector store", {
        collectionName,
        chunkCount: chunks.length,
    });
    await dependencies.vectorStore.addDocuments(collectionName, chunks);

    const duration = Date.now() - start;
    log.info("Book processing complete", {
        fileKey: input.fileKey,
        collectionName,
        chunkCount: chunks.length,
        durationMs: duration,
    });

    return {
        collectionName,
        chunks: chunks.length,
        reusedCollection: false,
        metadata: content.metadata,
    };
};

export const extractBookMetadata = (
    fileBuffer: Buffer,
    fileType: BookFileType
): Promise<ExtractedBookMetadata> =>
    fileType === "pdf"
        ? extractPdfMetadata(fileBuffer)
        : extractEpubMetadata(fileBuffer);
