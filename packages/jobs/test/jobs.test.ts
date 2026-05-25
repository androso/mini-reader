import assert from "node:assert/strict";
import test from "node:test";
import {
    assertProcessBookJobPayload,
    BOOK_PROCESSING_QUEUE,
    buildProcessBookJobOptions,
    PROCESS_BOOK_JOB,
} from "../src";

test("exports stable queue and job names", () => {
    assert.equal(BOOK_PROCESSING_QUEUE, "book-processing");
    assert.equal(PROCESS_BOOK_JOB, "process-book");
});

test("builds retryable process-book options with deterministic job id", () => {
    const options = buildProcessBookJobOptions("book-1");

    assert.equal(options.jobId, "book-1");
    assert.equal(options.attempts, 3);
    assert.deepEqual(options.backoff, {
        type: "exponential",
        delay: 2000,
    });
});

test("validates process-book payloads", () => {
    assert.deepEqual(
        assertProcessBookJobPayload({
            bookId: "book-1",
            userId: "user-1",
            fileKey: "epub-abc",
            fileType: "epub",
        }),
        {
            bookId: "book-1",
            userId: "user-1",
            fileKey: "epub-abc",
            fileType: "epub",
        }
    );

    assert.throws(
        () =>
            assertProcessBookJobPayload({
                bookId: "book-1",
                fileType: "docx",
            }),
        /Invalid process-book payload/
    );
});
