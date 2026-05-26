import { eq } from "drizzle-orm";
import type { SearchIndexStore } from "@reader/processing";
import { db } from "../db";
import { BookSearchChunks } from "../db/schema";

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
        await db
            .delete(BookSearchChunks)
            .where(eq(BookSearchChunks.collectionName, collectionName));

        if (!chunks.length) return;

        await db.insert(BookSearchChunks).values(
            chunks.map((content, chunkIndex) => ({
                id: createChunkId(collectionName, chunkIndex),
                collectionName,
                chunkIndex,
                content,
            }))
        );
    },

    async getCollectionChunks(collectionName) {
        return db
            .select()
            .from(BookSearchChunks)
            .where(eq(BookSearchChunks.collectionName, collectionName))
            .orderBy(BookSearchChunks.chunkIndex);
    },

    async deleteCollectionChunks(collectionName) {
        await db
            .delete(BookSearchChunks)
            .where(eq(BookSearchChunks.collectionName, collectionName));
    },
};
