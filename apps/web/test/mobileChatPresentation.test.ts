import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatSource = readFileSync(
    "src/components/reader/ChatInterface.tsx",
    "utf8"
);
const messageListSource = readFileSync(
    "src/components/reader/MessageList.tsx",
    "utf8"
);
const chatHistorySource = readFileSync(
    "src/components/reader/ChatHistory.tsx",
    "utf8"
);
const textBlockSource = readFileSync(
    "src/components/reader/TextBlock.tsx",
    "utf8"
);
const pageSource = readFileSync("src/app/read/[id]/page.tsx", "utf8");
const useChatSource = readFileSync("src/hooks/chat/useChat.ts", "utf8");

test("mobile chat uses a full opaque panel only when expanded", () => {
    assert.match(
        chatSource,
        /isExpanded\s*\?\s*"h-\[80dvh\] border border-\[var\(--color-chat-rule\)\] bg-\[var\(--color-chat\)\]/
    );
    assert.doesNotMatch(chatSource, /isExpanded \|\| hasConversation/);
    assert.doesNotMatch(chatSource, /hasVisibleConversation/);
    assert.match(chatSource, /isMobileChatOpen/);
});

test("mobile model selector tracks live composer focus and clears on blur", () => {
    assert.match(chatSource, /isComposerFocused/);
    assert.match(chatSource, /isComposerFocused && !chatState\.isHistoryOpen/);
    assert.match(chatSource, /onComposerFocusChange/);
    assert.match(
        chatSource,
        /onFocus=\{\(\) => onComposerFocusChange\(true\)\}/
    );
    assert.match(
        chatSource,
        /onPointerDown=\{\(\) => onComposerFocusChange\(true\)\}/
    );
    assert.match(chatSource, /onComposerFocusChange\(false\)/);
    assert.doesNotMatch(chatSource, /hasComposerBeenFocused/);
    assert.match(chatSource, /aria-label="Send message"/);
});

test("mobile chat history uses one bounded vertical scroll region", () => {
    assert.match(chatSource, /min-h-0 min-w-0 flex-1 overflow-hidden/);
    assert.doesNotMatch(chatSource, /overflow-scroll h-full/);
    assert.match(chatSource, /"Previous chats"/);
    assert.match(
        chatHistorySource,
        /flex h-full min-h-0 min-w-0 flex-col overflow-hidden/
    );
    assert.match(
        chatHistorySource,
        /min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto/
    );
    assert.doesNotMatch(chatHistorySource, /<ScrollArea/);
});

test("sending a message opens the full mobile chat instead of a compact view", () => {
    assert.match(useChatSource, /isExpanded: true/);
    assert.match(
        useChatSource,
        /messages: \[\.\.\.prev\.messages, userMessage\],[\s\S]*isExpanded: true/
    );
    assert.doesNotMatch(messageListSource, /h-\[200px\]/);
    assert.doesNotMatch(messageListSource, /messages\.slice\(-2\)/);
    assert.doesNotMatch(chatSource, /Minimize/);
    assert.doesNotMatch(chatSource, /Maximize2/);
    assert.match(chatSource, /aria-label="Close chat"/);
    assert.match(chatSource, /isChatOpen: false/);
    assert.match(chatSource, /isExpanded: false/);
    assert.match(chatSource, /isHistoryOpen: false/);
});

test("mobile chat displays a compact '1 context added' badge instead of full paragraph text", () => {
    assert.match(chatSource, /1 context added/);
    assert.match(chatSource, /isChatOpen: true/);
    assert.match(chatSource, /isExpanded: true/);
    assert.doesNotMatch(chatSource, /max-h-20 overflow-y-auto/);
});

test("swiping right and clicking ask about paragraph passes context on mobile", () => {
    assert.match(textBlockSource, /extractPlainText\(content\)/);
    assert.match(textBlockSource, /onAddHighlightContext\(text\)/);
    assert.match(pageSource, /onAddHighlightContext=\{\(text\) =>/);
});
