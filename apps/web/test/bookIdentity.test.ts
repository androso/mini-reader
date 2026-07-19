import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path: string) => readFileSync(path, "utf8");

test("library, reader, cover, and public book types use book IDs only", () => {
    const library = readSource("src/app/page.tsx");
    const reader = readSource("src/app/read/[id]/page.tsx");
    const cover = readSource("src/components/BookCover.tsx");
    const bookTypes = readSource("src/types/bookTypes.ts");

    assert.match(library, /`\/read\/\$\{book\.id\}\?type=/);
    assert.match(reader, /const bookId = params\.id/);
    assert.match(reader, /`\/api\/books\/\$\{bookId \?\? ""\}`/);
    assert.match(cover, /`\/api\/books\/\$\{book\.id\}`/);

    for (const source of [library, reader, cover, bookTypes]) {
        assert.doesNotMatch(source, /fileKey/);
    }
    assert.doesNotMatch(reader, /searchParams\.get\(["']bookId["']\)/);
});

test("progress, status, chat, and deletion callers retain book IDs and cookies", () => {
    const library = readSource("src/app/page.tsx");
    const progress = readSource("src/hooks/useTextBlockNavigation.ts");
    const status = readSource("src/hooks/useBookProcessingStatus.ts");
    const chat = readSource("src/hooks/chat/useChat.ts");

    assert.match(library, /`\/api\/books\/\$\{itemId\}`/);
    assert.match(progress, /`\/api\/\$\{bookId\}\/progress`/);
    assert.match(status, /`\/api\/books\/\$\{bookId\}\/status`/);
    assert.match(chat, /`\/api\/book\/\$\{bookId\}\/conversations/);
    for (const source of [library, progress, status, chat]) {
        assert.match(source, /credentials:\s*["']include["']/);
        assert.doesNotMatch(source, /fileKey/);
    }
});
