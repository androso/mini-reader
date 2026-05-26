import type { StorageProvider, VectorStoreProvider } from "@reader/providers";
import { storageProvider, vectorStore } from "@reader/providers";
import { createEpubCollectionName, extractEpubChunks } from "./epubIngestion";
import { createPdfCollectionName, extractPdfChunks } from "./pdfIngestion";

export type BookFileType = "epub" | "pdf";

export interface ProcessBookInput {
    fileKey: string;
    fileType: BookFileType;
    existingReadyCollectionName?: string | null;
    hasReadyBookForCollection?: boolean;
}

export interface ProcessBookDependencies {
    storage: StorageProvider;
    vectorStore: VectorStoreProvider;
    createEpubCollectionName?: (fileBuffer: Buffer) => Promise<string>;
    extractEpubChunks?: (fileBuffer: Buffer) => Promise<string[]>;
    createPdfCollectionName?: (fileBuffer: Buffer) => Promise<string>;
    extractPdfChunks?: (fileBuffer: Buffer) => Promise<string[]>;
}

export interface ProcessBookResult {
    collectionName: string;
    chunks: number;
    reusedCollection: boolean;
}

export const processBookForSearch = async (
    input: ProcessBookInput,
    dependencies: ProcessBookDependencies = {
        storage: storageProvider,
        vectorStore,
    }
): Promise<ProcessBookResult> => {
    if (input.existingReadyCollectionName) {
        return {
            collectionName: input.existingReadyCollectionName,
            chunks: 0,
            reusedCollection: true,
        };
    }

    const fileBuffer = await dependencies.storage.getFile(input.fileKey);
    const epubCollectionName =
        dependencies.createEpubCollectionName ?? createEpubCollectionName;
    const epubChunks = dependencies.extractEpubChunks ?? extractEpubChunks;
    const pdfCollectionName =
        dependencies.createPdfCollectionName ?? createPdfCollectionName;
    const pdfChunks = dependencies.extractPdfChunks ?? extractPdfChunks;

    const collectionName =
        input.fileType === "pdf"
            ? await pdfCollectionName(fileBuffer)
            : await epubCollectionName(fileBuffer);

    if (!input.hasReadyBookForCollection) {
        await dependencies.vectorStore.resetCollection(collectionName);
    }

    const chunks =
        input.fileType === "pdf"
            ? await pdfChunks(fileBuffer)
            : await epubChunks(fileBuffer);

    if (!chunks.length) {
        throw new Error("No valid text chunks extracted");
    }

    await dependencies.vectorStore.addDocuments(collectionName, chunks);

    return {
        collectionName,
        chunks: chunks.length,
        reusedCollection: false,
    };
};
