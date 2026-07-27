import assert from "node:assert/strict";
import test from "node:test";
import {
    BOOK_CONTEXT_FAILURE_MESSAGES,
    BOOK_CONTEXT_STATUSES,
    classifyStoredBookContext,
} from "../src/services/BookContextState";

test("stored book state classifies every safe context boundary", () => {
    assert.deepEqual(BOOK_CONTEXT_STATUSES, [
        "ready",
        "processing",
        "not_found",
        "ingestion_failed",
        "retrieval_unavailable",
        "no_relevant_context",
    ]);
    assert.equal(classifyStoredBookContext(null), "not_found");
    assert.equal(
        classifyStoredBookContext({
            processingStatus: "deleting",
            collectionName: "book_old",
        }),
        "not_found"
    );
    for (const processingStatus of ["failed", "queue_failed"]) {
        assert.equal(
            classifyStoredBookContext({
                processingStatus,
                collectionName: "book_failed",
            }),
            "ingestion_failed"
        );
    }
    assert.equal(
        classifyStoredBookContext({
            processingStatus: "processing",
            collectionName: "book_partial",
        }),
        "processing"
    );
    assert.equal(
        classifyStoredBookContext({
            processingStatus: "ready",
            collectionName: null,
        }),
        "retrieval_unavailable"
    );
    assert.equal(
        classifyStoredBookContext({
            processingStatus: "unexpected",
            collectionName: "book_unknown",
        }),
        "retrieval_unavailable"
    );
    assert.equal(
        classifyStoredBookContext({
            processingStatus: "ready",
            collectionName: "book_ready",
        }),
        "ready"
    );
});

test("context failures are fixed safe strings", () => {
    assert.deepEqual(Object.keys(BOOK_CONTEXT_FAILURE_MESSAGES).sort(), [
        "ingestion_failed",
        "not_found",
        "processing",
        "retrieval_unavailable",
    ]);
});
