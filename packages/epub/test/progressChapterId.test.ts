import assert from "node:assert/strict";
import test from "node:test";
import {
    chapterIdFromProgressPosition,
    resolveChapterIdFromProgress,
} from "../src/progressChapterId";

test("chapterIdFromProgressPosition recovers hyphenated chapter IDs", () => {
    assert.equal(
        chapterIdFromProgressPosition("chapter-1-block-3"),
        "chapter-1"
    );
    assert.equal(chapterIdFromProgressPosition("c01-block-16"), "c01");
    assert.equal(chapterIdFromProgressPosition("plain"), null);
    assert.equal(chapterIdFromProgressPosition(null), null);
});

test("resolveChapterIdFromProgress prefers an exact saved chapter ID", () => {
    assert.equal(
        resolveChapterIdFromProgress({
            progressChapter: "chapter-1",
            progressPosition: "chapter-1-block-2",
            availableChapterIds: ["chapter-1", "chapter-2"],
        }),
        "chapter-1"
    );
});

test("resolveChapterIdFromProgress recovers from legacy split('-')[0] values", () => {
    // Legacy saver stored progress_chapter = "chapter" for "chapter-1-block-2"
    assert.equal(
        resolveChapterIdFromProgress({
            progressChapter: "chapter",
            progressPosition: "chapter-1-block-2",
            availableChapterIds: ["chapter-1", "chapter-2"],
        }),
        "chapter-1"
    );
});

test("resolveChapterIdFromProgress returns null when nothing matches", () => {
    assert.equal(
        resolveChapterIdFromProgress({
            progressChapter: "missing",
            progressPosition: "missing-block-1",
            availableChapterIds: ["c01"],
        }),
        null
    );
});
