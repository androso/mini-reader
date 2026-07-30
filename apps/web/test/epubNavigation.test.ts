import assert from "node:assert/strict";
import test from "node:test";
import {
    buildChapterOrder,
    buildMobileChapterOrder,
    chapterIdFromProgressPosition,
    findChapterByHref,
    findManifestEntryByHref,
    getAdjacentChapterId,
    getHrefMatchKeys,
    normalizeEpubHref,
    resolveChapterIdFromProgress,
    resolveTocHrefToSpineId,
    splitEpubHref,
    stripEpubFileExtension,
} from "../src/lib/epubNavigation";

const content = {
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
            href: "text/chap2.xhtml",
            mediaType: "application/xhtml+xml",
            properties: null,
        },
        s3: {
            href: "chap3.xhtml",
            mediaType: "application/xhtml+xml",
            properties: null,
        },
    },
    toc: [
        { title: "One", level: 0, href: "chap1.xhtml" },
        { title: "Two", level: 0, href: "text/chap2.xhtml#intro" },
    ],
};

test("splitEpubHref and stripEpubFileExtension parse path fragments", () => {
    for (const [href, expected] of [
        [null, { path: "", fragment: null }],
        [undefined, { path: "", fragment: null }],
        ["chap1.xhtml", { path: "chap1.xhtml", fragment: null }],
        ["chap1.xhtml#frag", { path: "chap1.xhtml", fragment: "frag" }],
        ["chap1.xhtml?q=1#frag", { path: "chap1.xhtml", fragment: "frag" }],
    ] as const) {
        assert.deepEqual(splitEpubHref(href), expected, String(href));
    }

    for (const [pathValue, expected] of [
        ["chap1.xhtml", "chap1"],
        ["chap1.HTML", "chap1"],
        ["dir/chap1.htm", "dir/chap1"],
        ["no-extension", "no-extension"],
    ] as const) {
        assert.equal(stripEpubFileExtension(pathValue), expected);
    }
});

test("normalizeEpubHref and getHrefMatchKeys canonicalize relative hrefs", () => {
    assert.equal(normalizeEpubHref("./text/../chap1.xhtml#x"), "chap1");
    assert.equal(
        normalizeEpubHref("./text/chap2.xhtml#intro", {
            preserveFragment: true,
        }),
        "text/chap2#intro"
    );
    assert.deepEqual(
        [...getHrefMatchKeys("text/chap2.xhtml")].sort(),
        ["chap2", "text/chap2"].sort()
    );
});

test("manifest and TOC helpers resolve spine ids from hrefs", () => {
    assert.deepEqual(findManifestEntryByHref(content.manifest, "chap1.xhtml"), {
        id: "s1",
        item: content.manifest.s1,
    });
    assert.equal(
        findManifestEntryByHref(content.manifest, "missing.xhtml"),
        null
    );
    assert.equal(
        resolveTocHrefToSpineId(content, "text/chap2.xhtml#intro"),
        "s2"
    );
    assert.equal(resolveTocHrefToSpineId(content, "missing.xhtml"), null);

    const chapters = [
        { id: "s1", hrefId: "chap1" },
        { id: "s2", hrefId: "text/chap2" },
    ];
    assert.deepEqual(findChapterByHref(chapters, "chap1.xhtml"), chapters[0]);
    assert.equal(findChapterByHref(chapters, "missing.xhtml"), undefined);
});

test("chapter order and adjacency follow TOC then spine bounds", () => {
    assert.deepEqual(buildChapterOrder(content), ["s1", "s2"]);
    assert.deepEqual(buildMobileChapterOrder(content), ["s1", "s2"]);
    assert.equal(getAdjacentChapterId(["s1", "s2", "s3"], "s2", "next"), "s3");
    assert.equal(
        getAdjacentChapterId(["s1", "s2", "s3"], "s1", "previous"),
        null
    );
    assert.equal(
        getAdjacentChapterId(["s1", "s2", "s3"], "missing", "next"),
        null
    );
});

test("progress helpers recover chapter ids from block positions", () => {
    for (const [position, expected] of [
        [null, null],
        ["", null],
        ["chapter-1-block-3", "chapter-1"],
        ["s2-block-0", "s2"],
        ["not-a-block", null],
    ] as const) {
        assert.equal(chapterIdFromProgressPosition(position), expected);
    }

    assert.equal(
        resolveChapterIdFromProgress({
            progressChapter: "s2",
            progressPosition: "s1-block-1",
            availableChapterIds: ["s1", "s2"],
        }),
        "s2"
    );
    assert.equal(
        resolveChapterIdFromProgress({
            progressChapter: "gone",
            progressPosition: "s1-block-1",
            availableChapterIds: ["s1", "s2"],
        }),
        "s1"
    );
    assert.equal(
        resolveChapterIdFromProgress({
            progressChapter: null,
            progressPosition: null,
            availableChapterIds: [],
        }),
        null
    );
});
