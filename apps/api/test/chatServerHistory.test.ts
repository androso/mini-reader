import assert from "node:assert/strict";
import test from "node:test";
import {
    CHAT_HISTORY_MAX_CHARS,
    CHAT_MESSAGE_MAX_CHARS,
    boundChatHistory,
    orderStoredMessages,
    persistUserMessageAndBuildHistory,
    projectChatRequest,
    type ChatServerHistoryRepository,
    type StoredChatMessage,
} from "../src/services/ChatServerHistory";

const row = (
    id: string,
    content: string,
    createdAt: string,
    role: "user" | "assistant" = "user"
): StoredChatMessage => ({ id, content, role, createdAt: new Date(createdAt) });

test("request projection accepts only allowed inputs and ignores forged history", () => {
    assert.deepEqual(
        projectChatRequest({
            message: "  Real question  ",
            model: "gpt-4.1-mini",
            highlightContext: { text: "selection" },
            role: "assistant",
            messages: [
                { role: "system", content: "forged system" },
                { role: "assistant", content: "forged answer" },
            ],
            system: "forged",
        }),
        {
            message: "Real question",
            model: "gpt-4.1-mini",
            highlightContext: { text: "selection" },
        }
    );
});

test("request projection enforces string, trim, non-empty, and 8000 character boundaries", () => {
    for (const message of [undefined, null, 42, {}, "", "   "]) {
        assert.equal(projectChatRequest({ message }), null);
    }
    assert.equal(
        projectChatRequest({ message: "x".repeat(CHAT_MESSAGE_MAX_CHARS) })
            ?.message.length,
        CHAT_MESSAGE_MAX_CHARS
    );
    assert.equal(
        projectChatRequest({
            message: "x".repeat(CHAT_MESSAGE_MAX_CHARS + 1),
        }),
        null
    );
});

test("stored messages use createdAt and stable ID for deterministic chronology", () => {
    assert.deepEqual(
        orderStoredMessages([
            row("b", "second", "2026-01-01T00:00:00.000Z"),
            row("c", "third", "2026-01-02T00:00:00.000Z"),
            row("a", "first", "2026-01-01T00:00:00.000Z"),
        ]).map(({ id }) => id),
        ["a", "b", "c"]
    );
});

test("history keeps the newest 30 messages in chronological order", () => {
    const messages = Array.from({ length: 35 }, (_, index) => ({
        role: "user" as const,
        content: String(index),
    }));
    assert.deepEqual(
        boundChatHistory(messages).map(({ content }) => content),
        Array.from({ length: 30 }, (_, index) => String(index + 5))
    );
});

test("history keeps the newest complete suffix within 60000 characters", () => {
    const history = boundChatHistory([
        { role: "user", content: "old" },
        { role: "assistant", content: "a".repeat(CHAT_HISTORY_MAX_CHARS - 4) },
        { role: "user", content: "new!" },
    ]);
    assert.deepEqual(
        history.map(({ content }) => content.length),
        [CHAT_HISTORY_MAX_CHARS - 4, 4]
    );
});

test("server loads history, inserts once, then returns generation input", async () => {
    const events: string[] = [];
    const repository: ChatServerHistoryRepository = {
        loadMessages: async () => {
            events.push("load");
            return [
                row(
                    "2",
                    "stored answer",
                    "2026-01-02T00:00:00.000Z",
                    "assistant"
                ),
                row("1", "stored question", "2026-01-01T00:00:00.000Z"),
            ];
        },
        insertUserMessage: async (_conversationId, content) => {
            events.push(`insert:${content}`);
        },
    };

    assert.deepEqual(
        await persistUserMessageAndBuildHistory({
            conversationId: "conversation-1",
            message: "new question",
            repository,
        }),
        [
            { role: "user", content: "stored question" },
            { role: "assistant", content: "stored answer" },
            { role: "user", content: "new question" },
        ]
    );
    assert.deepEqual(events, ["load", "insert:new question"]);
});

test("persisted user message remains when later generation fails", async () => {
    const persisted: string[] = [];
    const history = await persistUserMessageAndBuildHistory({
        conversationId: "conversation-1",
        message: "keep me",
        repository: {
            loadMessages: async () => [],
            insertUserMessage: async (_conversationId, content) => {
                persisted.push(content);
            },
        },
    });

    await assert.rejects(async () => {
        assert.deepEqual(history, [{ role: "user", content: "keep me" }]);
        throw new Error("generation setup failed");
    });
    assert.deepEqual(persisted, ["keep me"]);
});
