import { eq } from "drizzle-orm";
import type { SearchIndexStore } from "@reader/processing";
import { createLogger } from "@reader/providers";
import { db } from "../db";
import { BookSearchChunks } from "../db/schema";

const log = createLogger("BookSearchChunkStore");

export interface BookSearchChunk {
    id: string;
    collectionName: string;
    chunkIndex: number;
    content: string;
}

export const createChunkId = (collectionName: string, chunkIndex: number) =>
    `${collectionName}_${chunkIndex}`;

export const bookSearchChunkStore: SearchIndexStore & {
    getCollectionChunks(collectionName: string): Promise<BookSearchChunk[]>;
    deleteCollectionChunks(collectionName: string): Promise<void>;
} = {
    async replaceCollectionChunks(collectionName, chunks) {
        log.info("Replacing collection chunks in DB", {
            collectionName,
            chunkCount: chunks.length,
        });
        await db
            .delete(BookSearchChunks)
            .where(eq(BookSearchChunks.collectionName, collectionName));
        log.debug("Deleted existing collection chunks", { collectionName });

        if (!chunks.length) {
            log.debug("No chunks to insert", { collectionName });
            return;
        }

        await db.insert(BookSearchChunks).values(
            chunks.map((content, chunkIndex) => ({
                id: createChunkId(collectionName, chunkIndex),
                collectionName,
                chunkIndex,
                content,
            }))
        );
        log.info("Inserted collection chunks", {
            collectionName,
            chunkCount: chunks.length,
        });
    },

    async getCollectionChunks(collectionName) {
        log.debug("Fetching collection chunks from DB", { collectionName });
        const chunks = await db
            .select()
            .from(BookSearchChunks)
            .where(eq(BookSearchChunks.collectionName, collectionName))
            .orderBy(BookSearchChunks.chunkIndex);
        log.debug("Fetched collection chunks", {
            collectionName,
            chunkCount: chunks.length,
        });
        return chunks;
    },

    async deleteCollectionChunks(collectionName) {
        log.info("Deleting collection chunks from DB", { collectionName });
        await db
            .delete(BookSearchChunks)
            .where(eq(BookSearchChunks.collectionName, collectionName));
        log.info("Deleted collection chunks from DB", { collectionName });
    },
};
