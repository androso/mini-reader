import assert from "node:assert/strict";
import test from "node:test";
import type { BookProcessingRepository } from "../src/services/BookProcessingService";
import { handleProcessUploadedBook } from "../src/services/BookProcessingService";
import type { BookFileType } from "@reader/processing";

const payload = {
    bookId: "book-1",
    userId: "user-1",
    fileKey: "epub-key",
    fileType: "epub" as BookFileType,
};

const createRepository = (
    overrides: Partial<BookProcessingRepository> = {}
) => {
    const calls = {
        ready: [] as string[],
        failed: [] as string[],
    };
    const repository: BookProcessingRepository = {
        findBookForProcessing: async () => ({
            id: "book-1",
            userId: "user-1",
            fileKey: "epub-key",
            fileType: "epub",
            collectionName: null,
            processingStatus: "processing",
            processingError: null,
        }),
        findReadyDuplicate: async () => null,
        markReady: async (_, collectionName) => {
            calls.ready.push(collectionName);
        },
        markFailed: async (_, error) => {
            calls.failed.push(error);
        },
        ...overrides,
    };

    return { repository, calls };
};

test("successful synchronous processing marks book ready", async () => {
    const { repository, calls } = createRepository();

    const result = await handleProcessUploadedBook(
        payload,
        repository,
        async () => ({
            collectionName: "book_collection",
            chunks: 2,
            reusedCollection: false,
        })
    );

    assert.equal(result.collectionName, "book_collection");
    assert.deepEqual(calls.ready, ["book_collection"]);
    assert.deepEqual(calls.failed, []);
});

test("failed synchronous processing marks book failed", async () => {
    const { repository, calls } = createRepository();

    await assert.rejects(
        handleProcessUploadedBook(payload, repository, async () => {
            throw new Error("extract failed");
        }),
        /extract failed/
    );

    assert.deepEqual(calls.ready, []);
    assert.deepEqual(calls.failed, ["extract failed"]);
});

test("duplicate upload reuses ready collection", async () => {
    const { repository, calls } = createRepository({
        findReadyDuplicate: async () => ({ collectionName: "book_existing" }),
    });
    let seenExistingCollection: string | null | undefined;

    const result = await handleProcessUploadedBook(
        payload,
        repository,
        async (input) => {
            seenExistingCollection = input.existingReadyCollectionName;
            return {
                collectionName:
                    input.existingReadyCollectionName || "unexpected",
                chunks: 0,
                reusedCollection: true,
            };
        }
    );

    assert.equal(seenExistingCollection, "book_existing");
    assert.equal(result.reusedCollection, true);
    assert.deepEqual(calls.ready, ["book_existing"]);
});

test("file type mismatch fails safely", async () => {
    const { repository, calls } = createRepository({
        findBookForProcessing: async () => ({
            id: "book-1",
            userId: "user-1",
            fileKey: "epub-key",
            fileType: "pdf",
            collectionName: null,
            processingStatus: "processing",
            processingError: null,
        }),
    });

    await assert.rejects(
        handleProcessUploadedBook(payload, repository, async () => ({
            collectionName: "unexpected",
            chunks: 1,
            reusedCollection: false,
        })),
        /file type changed/
    );

    assert.deepEqual(calls.ready, []);
    assert.equal(calls.failed.length, 1);
});
