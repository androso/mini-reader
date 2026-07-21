import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    getStaleLockSeconds,
    getErrorMessage,
    getRetryDelaySeconds,
    shouldMarkBookFailed,
} from "../src/services/BookProcessingRunner";

test("runner marks book failed only on the final attempt", () => {
    assert.equal(shouldMarkBookFailed(1, 3), false);
    assert.equal(shouldMarkBookFailed(2, 3), false);
    assert.equal(shouldMarkBookFailed(3, 3), true);
    assert.equal(shouldMarkBookFailed(4, 3), true);
});

test("runner retry delay uses exponential backoff in seconds", () => {
    assert.equal(getRetryDelaySeconds(1, 5000), 5);
    assert.equal(getRetryDelaySeconds(2, 5000), 10);
    assert.equal(getRetryDelaySeconds(3, 5000), 20);
});

test("runner stale lock delay rounds up to seconds", () => {
    assert.equal(getStaleLockSeconds(1), 1);
    assert.equal(getStaleLockSeconds(1000), 1);
    assert.equal(getStaleLockSeconds(1001), 2);
});

test("runner reports nested connection errors from AggregateError", () => {
    const first = Object.assign(new Error("connect ECONNREFUSED ::1:5432"), {
        code: "ECONNREFUSED",
    });
    const second = new Error("connect ECONNREFUSED 127.0.0.1:5432");

    assert.equal(
        getErrorMessage(
            Object.assign(new Error(""), {
                name: "AggregateError",
                errors: [first, second],
            })
        ),
        "connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432"
    );
    assert.equal(getErrorMessage(new Error("")), "Error");
});

test("stale-lock and processing failure updates cannot overwrite deleting", () => {
    const runnerSource = readFileSync(
        "src/services/BookProcessingRunner.ts",
        "utf8"
    );
    const processingSource = readFileSync(
        "src/services/BookProcessingService.ts",
        "utf8"
    );
    const enqueueSource = readFileSync(
        "src/services/BookProcessingEnqueueService.ts",
        "utf8"
    );

    assert.match(
        runnerSource,
        /UPDATE books[\s\S]*?WHERE id IN \(SELECT book_id FROM stale_jobs\)[\s\S]*?AND processing_status = 'processing'/
    );
    assert.match(
        processingSource,
        /processingStatus, "processing"\)[\s\S]*?\.returning\(\{ id: Books\.id \}\)/
    );
    assert.match(enqueueSource, /eq\(Books\.processingStatus, "processing"\)/);
});
