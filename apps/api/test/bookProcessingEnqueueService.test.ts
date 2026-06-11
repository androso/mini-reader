import assert from "node:assert/strict";
import test from "node:test";
import type { BookProcessingEnqueueDependencies } from "../src/services/BookProcessingEnqueueService";
import {
    BookProcessingQueueUnavailableError,
    handleBookProcessingEnqueue,
} from "../src/services/BookProcessingEnqueueService";

const payload = {
    bookId: "book-1",
    userId: "user-1",
    fileKey: "epub-key",
    fileType: "epub" as const,
};

const createDependencies = (
    overrides: Partial<BookProcessingEnqueueDependencies> = {}
) => {
    const calls = {
        enqueued: [] as unknown[],
        failed: [] as Array<{ bookId: string; error: string }>,
        deleted: [] as string[],
        cleanupErrors: [] as unknown[],
    };

    const dependencies: BookProcessingEnqueueDependencies = {
        enqueue: async (data) => {
            calls.enqueued.push(data);
        },
        repository: {
            markQueueFailed: async (bookId, error) => {
                calls.failed.push({ bookId, error });
            },
            countBooksWithFileKey: async () => 1,
        },
        storage: {
            deleteFile: async (fileKey) => {
                calls.deleted.push(fileKey);
            },
        },
        onCleanupError: (error) => {
            calls.cleanupErrors.push(error);
        },
        ...overrides,
    };

    return { dependencies, calls };
};

test("successful enqueue leaves processing state untouched", async () => {
    const { dependencies, calls } = createDependencies();

    await handleBookProcessingEnqueue(payload, dependencies);

    assert.deepEqual(calls.enqueued, [payload]);
    assert.deepEqual(calls.failed, []);
    assert.deepEqual(calls.deleted, []);
});

test("enqueue failure marks book failed and deletes unshared upload", async () => {
    const { dependencies, calls } = createDependencies({
        enqueue: async () => {
            throw new Error("connect ECONNREFUSED");
        },
    });

    await assert.rejects(
        handleBookProcessingEnqueue(payload, dependencies),
        BookProcessingQueueUnavailableError
    );

    assert.deepEqual(calls.failed, [
        { bookId: "book-1", error: "connect ECONNREFUSED" },
    ]);
    assert.deepEqual(calls.deleted, ["epub-key"]);
});

test("enqueue failure does not delete a shared upload", async () => {
    const { dependencies, calls } = createDependencies({
        enqueue: async () => {
            throw new Error("connect ECONNREFUSED");
        },
        repository: {
            markQueueFailed: async (bookId, error) => {
                calls.failed.push({ bookId, error });
            },
            countBooksWithFileKey: async () => 2,
        },
    });

    await assert.rejects(
        handleBookProcessingEnqueue(payload, dependencies),
        BookProcessingQueueUnavailableError
    );

    assert.deepEqual(calls.failed, [
        { bookId: "book-1", error: "connect ECONNREFUSED" },
    ]);
    assert.deepEqual(calls.deleted, []);
});
