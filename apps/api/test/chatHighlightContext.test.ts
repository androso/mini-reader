import assert from "node:assert/strict";
import test from "node:test";
import {
    HIGHLIGHT_CONTEXT_MAX_CHARS,
    buildBookContextSystemPrompt,
    buildRetrievalQuery,
    normalizeHighlightContext,
} from "../src/services/HighlightContext";

test("normalizes valid EPUB highlight context", () => {
    const highlightContext = normalizeHighlightContext({
        sourceType: "epub",
        text: "  The selected passage.  ",
    });

    assert.deepEqual(highlightContext, {
        sourceType: "epub",
        text: "The selected passage.",
    });
});

test("ignores invalid or empty highlight context", () => {
    assert.equal(normalizeHighlightContext(null), null);
    assert.equal(
        normalizeHighlightContext({ sourceType: "pdf", text: "Ignored" }),
        null
    );
    assert.equal(
        normalizeHighlightContext({ sourceType: "epub", text: "   " }),
        null
    );
});

test("caps highlight context text", () => {
    const highlightContext = normalizeHighlightContext({
        sourceType: "epub",
        text: "x".repeat(HIGHLIGHT_CONTEXT_MAX_CHARS + 10),
    });

    assert.equal(highlightContext?.text.length, HIGHLIGHT_CONTEXT_MAX_CHARS);
});

test("adds highlight context to retrieval query when present", () => {
    const query = buildRetrievalQuery("What is happening?", {
        sourceType: "epub",
        text: "A highlighted passage about the scene.",
    });

    assert.match(query, /What is happening\?/);
    assert.match(query, /Selected passage:/);
    assert.match(query, /highlighted passage/);
});

test("keeps retrieval query unchanged without highlight context", () => {
    assert.equal(
        buildRetrievalQuery("What is happening?", null),
        "What is happening?"
    );
});

test("book context prompt includes selected passage only when present", () => {
    const promptWithHighlight = buildBookContextSystemPrompt(
        "Retrieved chunk",
        {
            sourceType: "epub",
            text: "Selected quote",
        }
    );
    const promptWithoutHighlight = buildBookContextSystemPrompt(
        "Retrieved chunk",
        null
    );

    assert.match(promptWithHighlight, /Selected passage from the user:/);
    assert.match(promptWithHighlight, /Selected quote/);
    assert.doesNotMatch(
        promptWithoutHighlight,
        /Selected passage from the user:/
    );
});
