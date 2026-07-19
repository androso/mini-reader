import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
