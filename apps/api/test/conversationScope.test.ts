import assert from "node:assert/strict";
import test from "node:test";
import {
    isConversationInScope,
    isValidResourceType,
} from "../src/services/ConversationScope";

test("validates supported conversation resource types", () => {
    assert.equal(isValidResourceType("book"), true);
    assert.equal(isValidResourceType("article"), true);
    assert.equal(isValidResourceType("podcast"), false);
    assert.equal(isValidResourceType(""), false);
});

test("matches conversations only within the authenticated resource scope", () => {
    const scope = {
        userId: "user-1",
        resourceType: "book",
        resourceId: "book-1",
    };

    assert.equal(
        isConversationInScope(
            {
                userId: "user-1",
                resourceType: "book",
                resourceId: "book-1",
            },
            scope
        ),
        true
    );
    assert.equal(
        isConversationInScope(
            {
                userId: "user-2",
                resourceType: "book",
                resourceId: "book-1",
            },
            scope
        ),
        false
    );
    assert.equal(
        isConversationInScope(
            {
                userId: "user-1",
                resourceType: "book",
                resourceId: "book-2",
            },
            scope
        ),
        false
    );
});
