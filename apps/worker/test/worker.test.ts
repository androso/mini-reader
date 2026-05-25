import assert from "node:assert/strict";
import test from "node:test";
import type { ProcessBookJobPayload } from "@reader/jobs";
import {
    type BookProcessingRepository,
    handleProcessBookJob,
} from "../src/jobHandler";

const payload: ProcessBookJobPayload = {
    bookId: "book-1",
    userId: "user-1",
    fileKey: "epub-key",
    fileType: "epub",
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

test("successful job marks book ready", async () => {
    const { repository, calls } = createRepository();

    const result = await handleProcessBookJob(
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

test("failed job marks book failed", async () => {
    const { repository, calls } = createRepository();

    await assert.rejects(
        handleProcessBookJob(payload, repository, async () => {
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

    const result = await handleProcessBookJob(
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

test("retry path delegates non-duplicate processing to deterministic processor", async () => {
    const { repository } = createRepository();
    let processorCalls = 0;

    await handleProcessBookJob(payload, repository, async (input) => {
        processorCalls += 1;
        assert.equal(input.existingReadyCollectionName, null);
        assert.equal(input.hasReadyBookForCollection, false);
        return {
            collectionName: "book_retry",
            chunks: 1,
            reusedCollection: false,
        };
    });

    assert.equal(processorCalls, 1);
});
