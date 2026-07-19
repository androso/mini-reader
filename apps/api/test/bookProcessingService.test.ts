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

test("failed processing can skip failed status for retryable attempts", async () => {
    const { repository, calls } = createRepository();

    await assert.rejects(
        handleProcessUploadedBook(
            payload,
            repository,
            async () => {
                throw new Error("temporary embedding failure");
            },
            { markFailedOnError: false }
        ),
        /temporary embedding failure/
    );

    assert.deepEqual(calls.ready, []);
    assert.deepEqual(calls.failed, []);
});

test("failed processing marks failed on final attempt option", async () => {
    const { repository, calls } = createRepository();

    await assert.rejects(
        handleProcessUploadedBook(
            payload,
            repository,
            async () => {
                throw new Error("final embedding failure");
            },
            { markFailedOnError: true }
        ),
        /final embedding failure/
    );

    assert.deepEqual(calls.ready, []);
    assert.deepEqual(calls.failed, ["final embedding failure"]);
});

test("processing ignores a stale queued file key and never looks up duplicates", async () => {
    const authoritativeFileKey = "users/user-1/books/book-1/original";
    const { repository, calls } = createRepository({
        findBookForProcessing: async () => ({
            id: "book-1",
            userId: "user-1",
            fileKey: authoritativeFileKey,
            fileType: "epub",
            collectionName: null,
            processingStatus: "processing",
            processingError: null,
        }),
    });
    let seenInput: { bookId: string; fileKey: string } | undefined;

    const result = await handleProcessUploadedBook(
        { ...payload, fileKey: "stale-queue-key" },
        repository,
        async (input) => {
            seenInput = { bookId: input.bookId, fileKey: input.fileKey };
            return {
                collectionName: "book_book_1",
                chunks: 2,
                reusedCollection: false,
            };
        }
    );

    assert.deepEqual(seenInput, {
        bookId: "book-1",
        fileKey: authoritativeFileKey,
    });
    assert.equal(result.reusedCollection, false);
    assert.deepEqual(calls.ready, ["book_book_1"]);
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
