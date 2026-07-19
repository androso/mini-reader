import assert from "node:assert/strict";
import test from "node:test";
import {
    BookProcessingRetryConflictError,
    type BookProcessingRetryDependencies,
    BookProcessingRetryNotFoundError,
    type RetryableBook,
    retryBookProcessing,
} from "../src/services/BookProcessingRetryService";
import {
    BookProcessingQueueUnavailableError,
    handleBookProcessingEnqueue,
} from "../src/services/BookProcessingEnqueueService";

const bookId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

const retryableBook = (
    overrides: Partial<RetryableBook> = {}
): RetryableBook => ({
    id: bookId,
    userId,
    fileKey: `users/${userId}/books/${bookId}/original`,
    fileType: "epub",
    processingStatus: "queue_failed",
    ...overrides,
});

const createDependencies = (book: RetryableBook | null) => {
    let claimed = false;
    const calls = {
        finds: [] as Array<{ bookId: string; userId: string }>,
        claims: [] as Array<{ bookId: string; userId: string }>,
        enqueues: [] as unknown[],
    };
    const dependencies: BookProcessingRetryDependencies = {
        repository: {
            findOwnedBook: async (requestedBookId, requestedUserId) => {
                calls.finds.push({
                    bookId: requestedBookId,
                    userId: requestedUserId,
                });
                return book;
            },
            claimRetry: async (requestedBookId, requestedUserId) => {
                calls.claims.push({
                    bookId: requestedBookId,
                    userId: requestedUserId,
                });
                if (!book || claimed) return null;
                claimed = true;
                return { ...book, processingStatus: "processing" };
            },
        },
        enqueue: async (payload) => {
            calls.enqueues.push(payload);
        },
    };
    return { calls, dependencies };
};

test("malformed IDs are concealed without querying the repository", async () => {
    const { calls, dependencies } = createDependencies(retryableBook());

    await assert.rejects(
        retryBookProcessing("not-a-uuid", userId, dependencies),
        BookProcessingRetryNotFoundError
    );

    assert.deepEqual(calls.finds, []);
    assert.deepEqual(calls.claims, []);
    assert.deepEqual(calls.enqueues, []);
});

test("missing and non-owned books share the not-found response", async () => {
    const { calls, dependencies } = createDependencies(null);

    await assert.rejects(
        retryBookProcessing(bookId, userId, dependencies),
        BookProcessingRetryNotFoundError
    );

    assert.deepEqual(calls.finds, [{ bookId, userId }]);
    assert.deepEqual(calls.claims, []);
    assert.deepEqual(calls.enqueues, []);
});

for (const book of [
    retryableBook({ processingStatus: "processing" }),
    retryableBook({ processingStatus: "ready" }),
    retryableBook({ fileType: null }),
]) {
    test(`rejects invalid retry state ${book.processingStatus}/${book.fileType}`, async () => {
        const { calls, dependencies } = createDependencies(book);

        await assert.rejects(
            retryBookProcessing(bookId, userId, dependencies),
            BookProcessingRetryConflictError
        );

        assert.deepEqual(calls.claims, []);
        assert.deepEqual(calls.enqueues, []);
    });
}

test("an accepted retry claims processing before enqueueing the immutable original", async () => {
    const book = retryableBook({ processingStatus: "failed", fileType: "pdf" });
    const { calls, dependencies } = createDependencies(book);

    const result = await retryBookProcessing(bookId, userId, dependencies);

    assert.deepEqual(result, { bookId, status: "processing" });
    assert.deepEqual(calls.claims, [{ bookId, userId }]);
    assert.deepEqual(calls.enqueues, [
        {
            bookId,
            userId,
            fileKey: book.fileKey,
            fileType: "pdf",
        },
    ]);
});

test("concurrent retries allow only the atomic state-claim winner to enqueue", async () => {
    const { calls, dependencies } = createDependencies(retryableBook());

    const results = await Promise.allSettled([
        retryBookProcessing(bookId, userId, dependencies),
        retryBookProcessing(bookId, userId, dependencies),
    ]);

    assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof BookProcessingRetryConflictError);
    assert.equal(calls.enqueues.length, 1);
});

test("a retry enqueue failure restores queue_failed through the shared enqueue boundary", async () => {
    const { dependencies } = createDependencies(retryableBook());
    const failedStates: Array<{ bookId: string; error: string }> = [];
    dependencies.enqueue = async (payload) =>
        handleBookProcessingEnqueue(payload, {
            enqueue: async () => {
                throw new Error("queue unavailable");
            },
            repository: {
                markQueueFailed: async (failedBookId, error) => {
                    failedStates.push({ bookId: failedBookId, error });
                },
            },
        });

    await assert.rejects(
        retryBookProcessing(bookId, userId, dependencies),
        BookProcessingQueueUnavailableError
    );
    assert.deepEqual(failedStates, [{ bookId, error: "queue unavailable" }]);
});
