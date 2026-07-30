import assert from "node:assert/strict";
import test from "node:test";
import {
    readerHighlightContextFromMessage,
    type ReaderBridgeMessage,
} from "../src/lib/readerBridge.js";

test("valid ask-context becomes HighlightContext", () => {
    assert.deepEqual(
        readerHighlightContextFromMessage({
            type: "ask-context",
            text: "  A focused paragraph.  ",
            chapterId: "ch-1",
            blockId: "block-1",
        }),
        {
            sourceType: "epub",
            text: "A focused paragraph.",
            chapterId: "ch-1",
            blockId: "block-1",
        }
    );
});

test("valid selection preserves empty blockId", () => {
    assert.deepEqual(
        readerHighlightContextFromMessage({
            type: "selection",
            text: "Selected range",
            chapterId: "ch-1",
            blockId: "",
        }),
        {
            sourceType: "epub",
            text: "Selected range",
            chapterId: "ch-1",
            blockId: "",
        }
    );
});

test("whitespace-only text returns null", () => {
    assert.equal(
        readerHighlightContextFromMessage({
            type: "ask-context",
            text: "   \n\t  ",
            chapterId: "ch-1",
            blockId: "block-1",
        }),
        null
    );
    assert.equal(
        readerHighlightContextFromMessage({
            type: "selection",
            text: "   ",
            chapterId: "ch-1",
            blockId: "block-1",
        }),
        null
    );
});

test("non-string IDs return null", () => {
    assert.equal(
        readerHighlightContextFromMessage({
            type: "ask-context",
            text: "Paragraph",
            chapterId: 12,
            blockId: "block-1",
        } as unknown as ReaderBridgeMessage),
        null
    );
    assert.equal(
        readerHighlightContextFromMessage({
            type: "selection",
            text: "Paragraph",
            chapterId: "ch-1",
            blockId: null,
        } as unknown as ReaderBridgeMessage),
        null
    );
});

test("empty Ask chapter or block IDs return null", () => {
    assert.equal(
        readerHighlightContextFromMessage({
            type: "ask-context",
            text: "Paragraph",
            chapterId: "",
            blockId: "block-1",
        }),
        null
    );
    assert.equal(
        readerHighlightContextFromMessage({
            type: "ask-context",
            text: "Paragraph",
            chapterId: "ch-1",
            blockId: "",
        }),
        null
    );
});

test("text longer than 4000 characters is capped exactly", () => {
    const text = "a".repeat(4010);
    const result = readerHighlightContextFromMessage({
        type: "ask-context",
        text,
        chapterId: "ch-1",
        blockId: "block-1",
    });
    assert.ok(result);
    assert.equal(result.text.length, 4000);
    assert.equal(result.text, "a".repeat(4000));
});

test("unrelated bridge messages return null", () => {
    assert.equal(readerHighlightContextFromMessage({ type: "tap" }), null);
    assert.equal(
        readerHighlightContextFromMessage({
            type: "visible-block",
            blockId: "block-1",
        }),
        null
    );
    assert.equal(
        readerHighlightContextFromMessage({
            type: "navigate",
            direction: "next",
        }),
        null
    );
    assert.equal(
        readerHighlightContextFromMessage({
            type: "pull-state",
            edge: "top",
            state: "pull",
        }),
        null
    );
});
