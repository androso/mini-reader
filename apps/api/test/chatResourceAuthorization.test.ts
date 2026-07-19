import assert from "node:assert/strict";
import test from "node:test";
import {
    authorizeChatResource,
    isSupportedChatResourceType,
    runAuthorizedChatResourceOperation,
    runAuthorizedScopedChatConversationOperation,
    type ChatResourceAuthorizationRepository,
} from "../src/services/ChatResourceAuthorization";

const repositoryWithBook = (
    book: { id: string; userId: string } | null,
    events: string[] = []
): ChatResourceAuthorizationRepository => ({
    findBookById: async () => {
        events.push("authorize");
        return book;
    },
});

test("supports only book chat resources", async () => {
    assert.equal(isSupportedChatResourceType("book"), true);
    assert.equal(isSupportedChatResourceType("article"), false);

    const result = await authorizeChatResource({
        resourceType: "article",
        resourceId: "article-1",
        userId: "user-1",
        repository: repositoryWithBook(null),
    });

    assert.deepEqual(result, {
        ok: false,
        status: 400,
        error: "Unsupported resource type",
    });
});

for (const rejected of [
    {
        name: "unsupported resource",
        resourceType: "article",
        book: null,
        status: 400,
        error: "Unsupported resource type",
        expectedEvents: [],
    },
    {
        name: "missing book",
        resourceType: "book",
        book: null,
        status: 404,
        error: "Book not found",
        expectedEvents: ["authorize"],
    },
    {
        name: "non-owned book",
        resourceType: "book",
        book: { id: "book-1", userId: "user-2" },
        status: 403,
        error: "Book access denied",
        expectedEvents: ["authorize"],
    },
] as const) {
    test(`${rejected.name} stops every route side effect`, async () => {
        const events: string[] = [];
        const sideEffects = {
            conversationInserts: 0,
            messageInserts: 0,
            headers: 0,
            retrievals: 0,
            traces: 0,
            modelCalls: 0,
        };

        const result = await runAuthorizedChatResourceOperation({
            resourceType: rejected.resourceType,
            resourceId: "book-1",
            userId: "user-1",
            repository: repositoryWithBook(rejected.book, events),
            operation: async () => {
                events.push("operation");
                sideEffects.conversationInserts++;
                sideEffects.messageInserts++;
                sideEffects.headers++;
                sideEffects.retrievals++;
                sideEffects.traces++;
                sideEffects.modelCalls++;
            },
        });

        assert.deepEqual(result, {
            ok: false,
            status: rejected.status,
            error: rejected.error,
        });
        assert.deepEqual(events, rejected.expectedEvents);
        assert.deepEqual(sideEffects, {
            conversationInserts: 0,
            messageInserts: 0,
            headers: 0,
            retrievals: 0,
            traces: 0,
            modelCalls: 0,
        });
    });
}

test("owned book authorizes before route orchestration", async () => {
    const events: string[] = [];
    const result = await runAuthorizedChatResourceOperation({
        resourceType: "book",
        resourceId: "book-1",
        userId: "user-1",
        repository: repositoryWithBook(
            { id: "book-1", userId: "user-1" },
            events
        ),
        operation: async (resourceType) => {
            events.push("insert", "headers", "retrieval", "model");
            return resourceType;
        },
    });

    assert.deepEqual(events, [
        "authorize",
        "insert",
        "headers",
        "retrieval",
        "model",
    ]);
    assert.deepEqual(result, {
        ok: true,
        resourceType: "book",
        value: "book",
    });
});

test("scoped conversation mismatch remains a 404 without append effects", async () => {
    const events: string[] = [];
    let messageInserts = 0;
    const result = await runAuthorizedScopedChatConversationOperation({
        resourceType: "book",
        resourceId: "book-1",
        userId: "user-1",
        conversationId: "conversation-from-another-scope",
        repository: repositoryWithBook(
            { id: "book-1", userId: "user-1" },
            events
        ),
        findScopedConversation: async (scope) => {
            events.push(
                `scope:${scope.userId}:${scope.resourceType}:${scope.resourceId}:${scope.conversationId}`
            );
            return null;
        },
        operation: async () => {
            messageInserts++;
        },
    });

    assert.deepEqual(result, {
        ok: false,
        status: 404,
        error: "Conversation not found",
    });
    assert.deepEqual(events, [
        "authorize",
        "scope:user-1:book:book-1:conversation-from-another-scope",
    ]);
    assert.equal(messageInserts, 0);
});
