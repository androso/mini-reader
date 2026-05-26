import assert from "node:assert/strict";
import test from "node:test";
import type { StorageProvider, VectorStoreProvider } from "@reader/providers";
import { processBookForSearch, TextChunker } from "../src";

const createMockStorage = (file = Buffer.from("book")): StorageProvider => ({
    uploadFile: async () => undefined,
    getFile: async () => file,
    deleteFile: async () => undefined,
});

const createMockVectorStore = () => {
    const calls = {
        resetCollection: [] as string[],
        addDocuments: [] as Array<{
            collectionName: string;
            documents: string[];
        }>,
    };
    const provider: VectorStoreProvider = {
        createCollection: async () => ({}),
        getOrCreateCollection: async () => ({}),
        getCollection: async () => null,
        queryCollection: async () => ({}),
        searchDocuments: async () => [],
        deleteCollection: async () => true,
        resetCollection: async (name) => {
            calls.resetCollection.push(name);
        },
        addDocuments: async (collectionName, documents) => {
            calls.addDocuments.push({ collectionName, documents });
        },
    };

    return { provider, calls };
};

const createMockSearchIndexStore = () => {
    const calls = {
        replaceCollectionChunks: [] as Array<{
            collectionName: string;
            chunks: string[];
        }>,
    };

    return {
        provider: {
            replaceCollectionChunks: async (
                collectionName: string,
                chunks: string[]
            ) => {
                calls.replaceCollectionChunks.push({
                    collectionName,
                    chunks,
                });
            },
        },
        calls,
    };
};

test("processes EPUB with mocked storage and vector store", async () => {
    const vector = createMockVectorStore();
    const searchIndex = createMockSearchIndexStore();

    const result = await processBookForSearch(
        {
            fileKey: "epub-key",
            fileType: "epub",
            hasReadyBookForCollection: false,
        },
        {
            storage: createMockStorage(),
            vectorStore: vector.provider,
            searchIndexStore: searchIndex.provider,
            createEpubCollectionName: async () => "book_test",
            extractEpubChunks: async () => ["one", "two"],
        }
    );

    assert.deepEqual(result, {
        collectionName: "book_test",
        chunks: 2,
        reusedCollection: false,
    });
    assert.deepEqual(vector.calls.resetCollection, ["book_test"]);
    assert.deepEqual(vector.calls.addDocuments, [
        { collectionName: "book_test", documents: ["one", "two"] },
    ]);
    assert.deepEqual(searchIndex.calls.replaceCollectionChunks, [
        { collectionName: "book_test", chunks: [] },
        { collectionName: "book_test", chunks: ["one", "two"] },
    ]);
});

test("processes PDF with mocked storage and vector store", async () => {
    const vector = createMockVectorStore();

    const result = await processBookForSearch(
        {
            fileKey: "pdf-key",
            fileType: "pdf",
            hasReadyBookForCollection: true,
        },
        {
            storage: createMockStorage(),
            vectorStore: vector.provider,
            createPdfCollectionName: async () => "pdf_test",
            extractPdfChunks: async () => ["pdf text"],
        }
    );

    assert.equal(result.collectionName, "pdf_test");
    assert.equal(result.chunks, 1);
    assert.deepEqual(vector.calls.resetCollection, []);
});

test("reuses an existing ready collection without reading storage", async () => {
    let readCount = 0;
    const vector = createMockVectorStore();
    const searchIndex = createMockSearchIndexStore();

    const result = await processBookForSearch(
        {
            fileKey: "epub-key",
            fileType: "epub",
            existingReadyCollectionName: "book_existing",
        },
        {
            storage: {
                ...createMockStorage(),
                getFile: async () => {
                    readCount += 1;
                    return Buffer.from("unexpected");
                },
            },
            vectorStore: vector.provider,
            searchIndexStore: searchIndex.provider,
        }
    );

    assert.equal(readCount, 0);
    assert.deepEqual(result, {
        collectionName: "book_existing",
        chunks: 0,
        reusedCollection: true,
    });
    assert.deepEqual(searchIndex.calls.replaceCollectionChunks, []);
});

test("fails when processing extracts no chunks", async () => {
    const vector = createMockVectorStore();

    await assert.rejects(
        processBookForSearch(
            {
                fileKey: "epub-key",
                fileType: "epub",
            },
            {
                storage: createMockStorage(),
                vectorStore: vector.provider,
                createEpubCollectionName: async () => "book_empty",
                extractEpubChunks: async () => [],
            }
        ),
        /No valid text chunks extracted/
    );
});

test("text chunker returns bounded chunks", () => {
    const chunker = new TextChunker({
        minChunkSize: 1,
        targetChunkSize: 20,
        maxChunkSize: 30,
    });

    const chunks = chunker.chunkText(
        "First sentence is here. Second sentence is here. Third sentence is here."
    );

    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= 30));
});
