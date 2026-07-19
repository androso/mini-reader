import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatSource = readFileSync("src/hooks/chat/useChat.ts", "utf8");
const messageListSource = readFileSync(
    "src/components/reader/MessageList.tsx",
    "utf8"
);

test("the browser applies terminal completion metadata to the assistant", () => {
    assert.match(chatSource, /jsonData\.type === "terminal"/);
    assert.match(chatSource, /completionStatus:\s*jsonData\.status \?\? null/);
    assert.match(
        chatSource,
        /finishReason:\s*jsonData\.finishReason \?\? null/
    );
});

test("non-complete assistant outcomes render stable user-facing notices", () => {
    assert.match(messageListSource, /reached the model output limit/);
    assert.match(messageListSource, /cancelled before completion/);
    assert.match(messageListSource, /failed before completion/);
    assert.doesNotMatch(messageListSource, /complete:\s*["'`]This response/);
});
