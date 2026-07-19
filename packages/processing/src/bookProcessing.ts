import type { StorageProvider, VectorStoreProvider } from "@reader/providers";
import { storageProvider, vectorStore, createLogger } from "@reader/providers";
import { extractEpubChunks } from "./epubIngestion";
import { extractPdfChunks } from "./pdfIngestion";

const log = createLogger("bookProcessing");

export type BookFileType = "epub" | "pdf";

export interface ProcessBookInput {
    bookId: string;
    fileKey: string;
    fileType: BookFileType;
}

export interface ProcessBookDependencies {
    storage: StorageProvider;
    vectorStore: VectorStoreProvider;
    searchIndexStore?: SearchIndexStore;
    extractEpubChunks?: (fileBuffer: Buffer) => Promise<string[]>;
    extractPdfChunks?: (fileBuffer: Buffer) => Promise<string[]>;
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

    const epubChunks = dependencies.extractEpubChunks ?? extractEpubChunks;
    const pdfChunks = dependencies.extractPdfChunks ?? extractPdfChunks;

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
    const chunks =
        input.fileType === "pdf"
            ? await pdfChunks(fileBuffer)
            : await epubChunks(fileBuffer);
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
    };
};
