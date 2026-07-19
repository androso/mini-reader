import assert from "node:assert/strict";
import test from "node:test";
import {
    createBookUploadPlan,
    createOriginalUploadKey,
} from "../src/utils/bookUpload";

test("one generated UUID is shared by the object key, book row, and queue job", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const plan = createBookUploadPlan(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "book.epub",
        "epub",
        () => id
    );

    assert.equal(plan.book.id, id);
    assert.equal(plan.job.bookId, id);
    assert.equal(plan.book.fileKey, plan.job.fileKey);
    assert.equal(
        plan.book.fileKey,
        `users/${plan.book.userId}/books/${id}/original`
    );
});

test("identical uploads remain isolated across books and users", () => {
    const first = createOriginalUploadKey(
        "user-a",
        "11111111-1111-1111-1111-111111111111"
    );
    const repeated = createOriginalUploadKey(
        "user-a",
        "22222222-2222-2222-2222-222222222222"
    );
    const otherUser = createOriginalUploadKey(
        "user-b",
        "33333333-3333-3333-3333-333333333333"
    );

    assert.equal(new Set([first, repeated, otherUser]).size, 3);
});
