import assert from "node:assert/strict";
import test from "node:test";
import type { db } from "../src/db";
import {
    createChunkId,
    replaceCollectionChunksWithDatabase,
} from "../src/services/BookSearchChunkStore";

interface StoredChunk {
    id: string;
    collectionName: string;
    chunkIndex: number;
    content: string;
}

const createTransactionalDatabase = (
    initialChunks: StoredChunk[],
    options: { failInsert?: boolean } = {}
) => {
    let committedChunks = structuredClone(initialChunks);
    let transactions = 0;

    const database = {
        transaction: async (
            callback: (transaction: {
                delete: () => {
                    where: () => Promise<void>;
                };
                insert: () => {
                    values: (chunks: StoredChunk[]) => Promise<void>;
                };
            }) => Promise<void>
        ) => {
            transactions += 1;
            let pendingChunks = structuredClone(committedChunks);
            const transaction = {
                delete: () => ({
                    where: async () => {
                        pendingChunks = [];
                    },
                }),
                insert: () => ({
                    values: async (chunks: StoredChunk[]) => {
                        if (options.failInsert) {
                            throw new Error("injected insert failure");
                        }
                        pendingChunks.push(...structuredClone(chunks));
                    },
                }),
            };

            await callback(transaction);
            committedChunks = pendingChunks;
        },
    } as unknown as typeof db;

    return {
        database,
        getCommittedChunks: () => structuredClone(committedChunks),
        getTransactionCount: () => transactions,
    };
};

const originalChunks: StoredChunk[] = [
    {
        id: "book_collection_0",
        collectionName: "book_collection",
        chunkIndex: 0,
        content: "old content",
    },
];

test("replacement commits new chunks with stable IDs in one transaction", async () => {
    const database = createTransactionalDatabase(originalChunks);

    await replaceCollectionChunksWithDatabase(
        database.database,
        "book_collection",
        ["first", "second"]
    );

    assert.equal(database.getTransactionCount(), 1);
    assert.deepEqual(database.getCommittedChunks(), [
        {
            id: createChunkId("book_collection", 0),
            collectionName: "book_collection",
            chunkIndex: 0,
            content: "first",
        },
        {
            id: createChunkId("book_collection", 1),
            collectionName: "book_collection",
            chunkIndex: 1,
            content: "second",
        },
    ]);
});

test("failed insertion rolls back deletion and retains old chunks", async () => {
    const database = createTransactionalDatabase(originalChunks, {
        failInsert: true,
    });

    await assert.rejects(
        replaceCollectionChunksWithDatabase(
            database.database,
            "book_collection",
            ["replacement"]
        ),
        /injected insert failure/
    );

    assert.equal(database.getTransactionCount(), 1);
    assert.deepEqual(database.getCommittedChunks(), originalChunks);
});

test("empty replacement commits deletion", async () => {
    const database = createTransactionalDatabase(originalChunks);

    await replaceCollectionChunksWithDatabase(
        database.database,
        "book_collection",
        []
    );

    assert.equal(database.getTransactionCount(), 1);
    assert.deepEqual(database.getCommittedChunks(), []);
});
