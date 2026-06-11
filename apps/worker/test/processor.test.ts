import assert from "node:assert/strict";
import test from "node:test";
import { processBookProcessingJob } from "../src/processor";

test("worker processor delegates book processing job payload", async () => {
    const seenPayloads: unknown[] = [];
    const payload = {
        bookId: "book-1",
        userId: "user-1",
        fileKey: "epub-key",
        fileType: "epub" as const,
    };

    await processBookProcessingJob({ data: payload }, async (data) => {
        seenPayloads.push(data);
        return {
            collectionName: "book_collection",
            chunks: 3,
            reusedCollection: false,
        };
    });

    assert.deepEqual(seenPayloads, [payload]);
});
