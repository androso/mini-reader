import assert from "node:assert/strict";
import test from "node:test";
import {
    getNextChapter,
    getTextBlockNavigationTarget,
    isLastChapter,
    shouldPersistVisibleTextBlock,
} from "../src/lib/readerNavigationBounds";

const blocks = [{ id: "block-1" }, { id: "block-2" }, { id: "block-3" }];

test("empty text blocks never produce a navigation target", () => {
    assert.equal(getTextBlockNavigationTarget([], null, "ArrowDown"), null);
    assert.equal(getTextBlockNavigationTarget([], null, "ArrowUp"), null);
});

test("null and unknown active blocks restart at the first block", () => {
    assert.equal(
        getTextBlockNavigationTarget(blocks, null, "ArrowUp"),
        blocks[0]
    );
    assert.equal(
        getTextBlockNavigationTarget(blocks, "missing", "ArrowDown"),
        blocks[0]
    );
});

test("first and last block navigation stops at the collection bounds", () => {
    assert.equal(
        getTextBlockNavigationTarget(blocks, "block-1", "ArrowUp"),
        null
    );
    assert.equal(
        getTextBlockNavigationTarget(blocks, "block-3", "ArrowDown"),
        null
    );
});

test("middle block navigation returns the adjacent block", () => {
    assert.equal(
        getTextBlockNavigationTarget(blocks, "block-2", "ArrowUp"),
        blocks[0]
    );
    assert.equal(
        getTextBlockNavigationTarget(blocks, "block-2", "ArrowDown"),
        blocks[2]
    );
});

test("a single block can initialize but cannot advance past either bound", () => {
    const singleBlock = [{ id: "only-block" }];

    assert.equal(
        getTextBlockNavigationTarget(singleBlock, null, "ArrowDown"),
        singleBlock[0]
    );
    assert.equal(
        getTextBlockNavigationTarget(singleBlock, "only-block", "ArrowUp"),
        null
    );
    assert.equal(
        getTextBlockNavigationTarget(singleBlock, "only-block", "ArrowDown"),
        null
    );
});

test("chapter navigation advances once and stops for unknown or last chapters", () => {
    const chapters = [
        { id: "chapter-1", hrefId: "chapter-1.xhtml" },
        { id: "chapter-2", hrefId: "chapter-2.xhtml" },
    ];

    assert.equal(getNextChapter(chapters, chapters[0]), chapters[1]);
    assert.equal(isLastChapter(chapters, chapters[0]), false);
    assert.equal(getNextChapter(chapters, chapters[1]), null);
    assert.equal(isLastChapter(chapters, chapters[1]), true);
    assert.equal(getNextChapter(chapters, { id: "missing" }), null);
    assert.equal(isLastChapter(chapters, { id: "missing" }), true);
});

test("visible progress persists only when the active block changes", () => {
    assert.equal(shouldPersistVisibleTextBlock(null, "block-1"), false);
    assert.equal(shouldPersistVisibleTextBlock("block-1", "block-1"), false);
    assert.equal(shouldPersistVisibleTextBlock("block-2", "block-1"), true);
});
