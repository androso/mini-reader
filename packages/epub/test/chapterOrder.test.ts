import assert from "node:assert/strict";
import test from "node:test";
import { buildChapterOrder, getAdjacentChapterId } from "../src/chapterOrder";
import type { EpubContent } from "../src/types";

const baseContent = (overrides: Partial<EpubContent> = {}): EpubContent => ({
    metadata: { title: "Test", creator: "Author" },
    basePath: "OEBPS/",
    spine: ["s1", "s2", "s3"],
    manifest: {
        s1: {
            href: "chap1.xhtml",
            mediaType: "application/xhtml+xml",
            properties: null,
        },
        s2: {
            href: "chap2.xhtml",
            mediaType: "application/xhtml+xml",
            properties: null,
        },
        s3: {
            href: "chap3.xhtml",
            mediaType: "application/xhtml+xml",
            properties: null,
        },
    },
    toc: [],
    ...overrides,
});

test("buildChapterOrder maps TOC hrefs to spine order and de-duplicates shared files", () => {
    const content = baseContent({
        toc: [
            { title: "One", level: 0, href: "chap1.xhtml" },
            { title: "One A", level: 1, href: "chap1.xhtml#section-a" },
            { title: "Two", level: 0, href: "chap2.xhtml#intro" },
            { title: "Two B", level: 1, href: "./chap2.xhtml" },
            { title: "Three", level: 0, href: "chap3.xhtml" },
        ],
    });

    assert.deepEqual(buildChapterOrder(content), ["s1", "s2", "s3"]);
});

test("buildChapterOrder ignores malformed and unresolvable TOC entries", () => {
    const content = baseContent({
        toc: [
            { title: "Missing href", level: 0 },
            { title: "Unknown file", level: 0, href: "missing.xhtml" },
            { title: "Valid", level: 0, href: "chap2.xhtml#frag" },
            { title: "Empty href", level: 0, href: "" },
        ],
    });

    assert.deepEqual(buildChapterOrder(content), ["s2"]);
});

test("buildChapterOrder falls back to spine when TOC is absent or unusable", () => {
    assert.deepEqual(buildChapterOrder(baseContent({ toc: [] })), [
        "s1",
        "s2",
        "s3",
    ]);
    assert.deepEqual(
        buildChapterOrder(
            baseContent({
                toc: [{ title: "Nope", level: 0, href: "ghost.xhtml" }],
            })
        ),
        ["s1", "s2", "s3"]
    );
});

test("getAdjacentChapterId respects book bounds", () => {
    const order = ["s1", "s2", "s3"];
    assert.equal(getAdjacentChapterId(order, "s1", "previous"), null);
    assert.equal(getAdjacentChapterId(order, "s1", "next"), "s2");
    assert.equal(getAdjacentChapterId(order, "s3", "next"), null);
    assert.equal(getAdjacentChapterId(order, "s3", "previous"), "s2");
    assert.equal(getAdjacentChapterId(order, "missing", "next"), null);
});
