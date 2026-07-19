import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    CHAT_INPUT_MAX_CHARS,
    normalizeChatInput,
} from "../src/hooks/chat/chatInput";

const source = readFileSync("src/hooks/chat/useChat.ts", "utf8");
const body = source.match(/body:\s*JSON\.stringify\(\{([\s\S]*?)\}\),/)?.[1];

test("chat transport sends only message, model, and optional highlight context", () => {
    assert.ok(body, "chat request body was not found");
    assert.match(body, /message:\s*userMessage\.content/);
    assert.match(body, /\bmodel\b/);
    assert.match(body, /highlightContext/);
    assert.doesNotMatch(body, /\brole\s*:/);
    assert.doesNotMatch(body, /\bmessages\s*:/);
    assert.doesNotMatch(body, /chatState\.messages/);
});

test("chat input is trimmed before optimistic state and transport", () => {
    assert.equal(normalizeChatInput("  question  "), "question");
    assert.equal(normalizeChatInput(" \n\t "), null);
    assert.match(source, /const message = normalizeChatInput\(input\)/);
    assert.match(
        source,
        /const userMessage = \{ id: null, role: "user", content: message \}/
    );
    assert.match(source, /if \(!message\) return;[\s\S]*?setInput\(""\)/);
});

test("chat input rejects oversized messages before optimistic state", () => {
    assert.equal(
        normalizeChatInput("x".repeat(CHAT_INPUT_MAX_CHARS))?.length,
        CHAT_INPUT_MAX_CHARS
    );
    assert.equal(
        normalizeChatInput("x".repeat(CHAT_INPUT_MAX_CHARS + 1)),
        null
    );
});
