import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatSource = readFileSync(
    "src/components/reader/ChatInterface.tsx",
    "utf8"
);

test("mobile chat gains an opaque surface only when conversation UI exists", () => {
    assert.match(chatSource, /isExpanded \|\| hasConversation/);
    assert.match(
        chatSource,
        /chatState\.messages\.length > 0 \|\| chatState\.isHistoryOpen/
    );
    assert.match(chatSource, /bg-\[var\(--color-chat\)\]/);
    assert.match(chatSource, /text-\[var\(--color-chat-text\)\]/);
});

test("mobile model selection appears after the composer has been focused", () => {
    assert.match(chatSource, /hasComposerBeenFocused/);
    assert.match(chatSource, /showModelSelector=\{!isMobile \|\|/);
    assert.match(chatSource, /onFocus=\{onInputFocus\}/);
    assert.match(chatSource, /onPointerDown=\{onInputFocus\}/);
    assert.match(chatSource, /aria-label="Send message"/);
});

test("visible mobile conversations can expand, minimize, and close", () => {
    assert.match(chatSource, /hasVisibleConversation/);
    assert.match(chatSource, /aria-label=\{`\$\{resizeLabel\} chat`\}/);
    assert.match(chatSource, /isExpanded \? "Minimize" : "Expand"/);
    assert.match(chatSource, /aria-label="Close chat"/);
    assert.match(chatSource, /isChatOpen: false/);
    assert.match(chatSource, /isExpanded: false/);
    assert.match(chatSource, /isHistoryOpen: false/);
});
