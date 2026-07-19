import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path: string) => readFileSync(path, "utf8");

test("processing status treats queue failure as terminal and retries by book ID", () => {
    const hook = readSource("src/hooks/useBookProcessingStatus.ts");

    assert.match(hook, /"queue_failed"/);
    assert.match(hook, /`\/api\/books\/\$\{bookId\}\/retry`/);
    assert.match(hook, /method:\s*"POST"/);
    assert.match(hook, /credentials:\s*"include"/);
    assert.match(hook, /invalidateQueries/);
    assert.doesNotMatch(hook, /fileKey/);
});

test("chat offers one retry action for queue and processing failures", () => {
    const chat = readSource("src/components/reader/ChatInterface.tsx");

    assert.match(chat, /processingStatus\?\.status === "queue_failed"/);
    assert.match(chat, /Retry processing/);
    assert.match(chat, /disabled=\{isRetrying\}/);
});
