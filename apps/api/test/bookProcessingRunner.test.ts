import assert from "node:assert/strict";
import test from "node:test";
import {
    getStaleLockSeconds,
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
