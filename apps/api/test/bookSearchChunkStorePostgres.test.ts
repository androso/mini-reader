import assert from "node:assert/strict";
import test from "node:test";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";

test(
    "bookSearchChunkStore getCollectionChunks and deleteCollectionChunks use Postgres",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_chunk_store",
            { migrate: true },
            async ({ url }) => {
                let pool: (typeof import("../src/db"))["pool"] | undefined;

                try {
                    process.env.DATABASE_URL = url;
                    const { bookSearchChunkStore, createChunkId } =
                        await import("../src/services/BookSearchChunkStore");
                    ({ pool } = await import("../src/db"));

                    const collectionName = "book_chunk_store_fixture";
                    await bookSearchChunkStore.replaceCollectionChunks(
                        collectionName,
                        ["alpha chunk", "beta chunk"]
                    );

                    const chunks =
                        await bookSearchChunkStore.getCollectionChunks(
                            collectionName
                        );
                    assert.deepEqual(
                        chunks.map((chunk) => ({
                            id: chunk.id,
                            collectionName: chunk.collectionName,
                            chunkIndex: chunk.chunkIndex,
                            content: chunk.content,
                        })),
                        [
                            {
                                id: createChunkId(collectionName, 0),
                                collectionName,
                                chunkIndex: 0,
                                content: "alpha chunk",
                            },
                            {
                                id: createChunkId(collectionName, 1),
                                collectionName,
                                chunkIndex: 1,
                                content: "beta chunk",
                            },
                        ]
                    );

                    await bookSearchChunkStore.deleteCollectionChunks(
                        collectionName
                    );
                    assert.deepEqual(
                        await bookSearchChunkStore.getCollectionChunks(
                            collectionName
                        ),
                        []
                    );
                } finally {
                    if (pool) await pool.end();
                }
            }
        );
    }
);
