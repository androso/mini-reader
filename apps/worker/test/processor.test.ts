import assert from "node:assert/strict";
import test from "node:test";
import { processBookProcessingJob } from "../src/processor";

test("worker processor delegates book processing job payload", async () => {
    const seenCalls: unknown[] = [];
    const payload = {
        bookId: "book-1",
        userId: "user-1",
        fileKey: "epub-key",
        fileType: "epub" as const,
    };

    await processBookProcessingJob(
        { attemptsMade: 0, data: payload, opts: { attempts: 3 } },
        async (data, options) => {
            seenCalls.push({ data, options });
            return {
                collectionName: "book_collection",
                chunks: 3,
                reusedCollection: false,
            };
        }
    );

    assert.deepEqual(seenCalls, [
        { data: payload, options: { markFailedOnError: false } },
    ]);
});

test("worker processor marks failed on final attempt", async () => {
    const seenOptions: unknown[] = [];
    const payload = {
        bookId: "book-1",
        userId: "user-1",
        fileKey: "epub-key",
        fileType: "epub" as const,
    };

    await processBookProcessingJob(
        { attemptsMade: 2, data: payload, opts: { attempts: 3 } },
        async (_, options) => {
            seenOptions.push(options);
            return {
                collectionName: "book_collection",
                chunks: 3,
                reusedCollection: false,
            };
        }
    );

    assert.deepEqual(seenOptions, [{ markFailedOnError: true }]);
});

test("worker processor treats missing attempts as final attempt", async () => {
    const seenOptions: unknown[] = [];
    const payload = {
        bookId: "book-1",
        userId: "user-1",
        fileKey: "epub-key",
        fileType: "epub" as const,
    };

    await processBookProcessingJob(
        { attemptsMade: 0, data: payload, opts: {} },
        async (_, options) => {
            seenOptions.push(options);
            return {
                collectionName: "book_collection",
                chunks: 3,
                reusedCollection: false,
            };
        }
    );

    assert.deepEqual(seenOptions, [{ markFailedOnError: true }]);
});

test("worker processor rethrows processing errors for BullMQ retry", async () => {
    const payload = {
        bookId: "book-1",
        userId: "user-1",
        fileKey: "epub-key",
        fileType: "epub" as const,
    };

    await assert.rejects(
        processBookProcessingJob(
            { attemptsMade: 0, data: payload, opts: { attempts: 3 } },
            async () => {
                throw new Error("temporary embedding failure");
            }
        ),
        /temporary embedding failure/
    );
});
