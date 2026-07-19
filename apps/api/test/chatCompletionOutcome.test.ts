import assert from "node:assert/strict";
import test from "node:test";
import {
    classifyChatCompletionStatus,
    createResponseAbortController,
    isAbortError,
} from "../src/services/ChatCompletionOutcome";
import { EventEmitter } from "node:events";

test("chat completion outcomes distinguish provider terminal states", () => {
    assert.equal(
        classifyChatCompletionStatus({
            finishReason: "stop",
            aborted: false,
            failed: false,
        }),
        "complete"
    );
    assert.equal(
        classifyChatCompletionStatus({
            finishReason: "length",
            aborted: false,
            failed: false,
        }),
        "truncated"
    );
    assert.equal(
        classifyChatCompletionStatus({
            finishReason: null,
            aborted: true,
            failed: false,
        }),
        "cancelled"
    );
    assert.equal(
        classifyChatCompletionStatus({
            finishReason: "content_filter",
            aborted: false,
            failed: false,
        }),
        "failed"
    );
    assert.equal(
        classifyChatCompletionStatus({
            finishReason: null,
            aborted: false,
            failed: true,
        }),
        "failed"
    );
});

test("AbortError is recognized even when a provider creates a fresh error", () => {
    const error = new Error("cancelled");
    error.name = "AbortError";

    assert.equal(isAbortError(error), true);
    assert.equal(isAbortError(new Error("unavailable")), false);
});

test("response close aborts generation and cleanup removes the listener", () => {
    const response = new EventEmitter();
    const responseAbort = createResponseAbortController(response);

    assert.equal(responseAbort.controller.signal.aborted, false);
    assert.equal(response.listenerCount("close"), 1);

    response.emit("close");

    assert.equal(responseAbort.wasClosed(), true);
    assert.equal(responseAbort.controller.signal.aborted, true);
    responseAbort.cleanup();
    assert.equal(response.listenerCount("close"), 0);
});
