import crypto from "crypto";
import {
    extractEpubTextBlocks,
    processEpubBuffer,
} from "@reader/epub/dist/server";
import { TextChunker } from "./chunkText";
import {
    normalizeBookMetadataValue,
    type ExtractedBookContent,
    type ExtractedBookMetadata,
} from "./bookProcessing";

export const createEpubCollectionName = async (fileBuffer: Buffer) => {
    const [content] = await processEpubBuffer(fileBuffer);
    const normalized = {
        title: content.metadata.title?.trim(),
        creator: content.metadata.creator?.trim(),
        identifier: content.metadata.identifier?.trim(),
    };
    const hash = crypto.createHash("sha256");
    hash.update(JSON.stringify(normalized));
    return `book_${hash.digest("hex").slice(0, 12)}`;
};

export const extractEpubBook = async (
    fileBuffer: Buffer,
    chunker = new TextChunker()
): Promise<ExtractedBookContent> => {
    const content = await extractEpubTextBlocks(fileBuffer);
    const chunks: string[] = [];

    for (const chapter of content.chapters) {
        for (const block of chapter.textBlocks) {
            chunks.push(...chunker.chunkText(block.text));
        }
    }

    return {
        chunks,
        metadata: normalizeEpubMetadata(content.content.metadata),
    };
};

const normalizeEpubMetadata = (metadata: {
    title?: unknown;
    creator?: unknown;
    identifier?: unknown;
}): ExtractedBookMetadata => ({
    title: normalizeBookMetadataValue(metadata.title),
    creator: normalizeBookMetadataValue(metadata.creator),
    identifier: normalizeBookMetadataValue(metadata.identifier),
});

export const extractEpubMetadata = async (
    fileBuffer: Buffer
): Promise<ExtractedBookMetadata> => {
    const [content] = await processEpubBuffer(fileBuffer);
    return normalizeEpubMetadata(content.metadata);
};
