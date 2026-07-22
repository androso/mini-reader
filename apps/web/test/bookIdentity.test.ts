import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createReaderPath, isPdfFileType } from "../src/lib/bookReaderRouting";

const readSource = (path: string) => readFileSync(path, "utf8");

test("library, reader, cover, and public book types use book IDs only", () => {
    const library = readSource("src/app/page.tsx");
    const reader = readSource("src/app/read/[id]/page.tsx");
    const cover = readSource("src/components/BookCover.tsx");
    const coverLoading = readSource("src/components/bookCoverLoading.ts");
    const bookTypes = readSource("src/types/bookTypes.ts");

    assert.match(library, /router\.push\(createReaderPath\(book\)\)/);
    assert.match(reader, /const bookId = params\.id/);
    assert.match(reader, /`\/api\/books\/\$\{bookId \?\? ""\}`/);
    assert.match(coverLoading, /`\/api\/books\/\$\{bookId\}`/);

    for (const source of [library, reader, cover, coverLoading, bookTypes]) {
        assert.doesNotMatch(source, /fileKey/);
    }
    assert.doesNotMatch(reader, /searchParams\.get\(["']bookId["']\)/);
});

test("a projected legacy PDF navigates by book ID and selects PdfReader", () => {
    const publicBook = {
        id: "legacy-pdf-book-id",
        fileType: "pdf" as const,
    };

    const readerPath = createReaderPath(publicBook);
    assert.equal(readerPath, "/read/legacy-pdf-book-id?type=pdf");

    const url = new URL(readerPath, "https://reader.example");
    assert.equal(url.pathname, "/read/legacy-pdf-book-id");
    assert.equal(isPdfFileType(url.searchParams.get("type")), true);
    assert.doesNotMatch(readerPath, /fileKey|bookId=/);

    const reader = readSource("src/app/read/[id]/page.tsx");
    assert.match(reader, /const isPdf = isPdfFileType\(fileType\)/);
    assert.match(reader, /isPdf \? \(/);
    assert.match(reader, /<PdfReader url=\{bookUrl\}/);
});

test("progress, status, chat, and deletion callers retain book IDs and cookies", () => {
    const library = readSource("src/app/page.tsx");
    const progress = readSource("src/hooks/useTextBlockNavigation.ts");
    const epubReader = readSource("src/components/reader/EpubReader.tsx");
    const reader = readSource("src/app/read/[id]/page.tsx");
    const status = readSource("src/hooks/useBookProcessingStatus.ts");
    const chat = readSource("src/hooks/chat/useChat.ts");

    assert.match(library, /`\/api\/books\/\$\{itemId\}`/);
    assert.match(progress, /`\/api\/\$\{bookId\}\/progress`/);
    assert.match(progress, /contentRef[^,]*,[\s\S]*?bookId: string/);
    assert.doesNotMatch(
        progress,
        /window\.location|URLSearchParams|localStorage/
    );
    assert.match(
        epubReader,
        /useTextBlockNavigation\(\s*flatTextBlocks,\s*contentRef,\s*bookId/
    );
    assert.equal(
        (reader.match(/<EpubReader[\s\S]*?bookId=\{bookId \?\? ""\}/g) ?? [])
            .length,
        2
    );
    assert.match(status, /`\/api\/books\/\$\{bookId\}\/status`/);
    assert.match(chat, /`\/api\/book\/\$\{bookId\}\/conversations/);
    for (const source of [library, progress, status, chat]) {
        assert.match(source, /credentials:\s*["']include["']/);
        assert.doesNotMatch(source, /fileKey/);
    }
});
