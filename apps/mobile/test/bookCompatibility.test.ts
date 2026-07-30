import assert from "node:assert/strict";
import test from "node:test";
import {
    IOS_PDF_UNAVAILABLE_MESSAGE,
    bookUnavailableReason,
    documentTypesForPlatform,
    isPdfDocument,
} from "../src/lib/bookCompatibility.js";

test("bookUnavailableReason returns the iOS PDF message only for iOS PDFs", () => {
    assert.equal(
        bookUnavailableReason("ios", "pdf"),
        IOS_PDF_UNAVAILABLE_MESSAGE
    );
    assert.equal(bookUnavailableReason("ios", "epub"), null);
    assert.equal(bookUnavailableReason("ios", null), null);
    assert.equal(bookUnavailableReason("android", "pdf"), null);
    assert.equal(bookUnavailableReason("android", "epub"), null);
});

test("documentTypesForPlatform returns EPUB-only types on iOS", () => {
    assert.deepEqual(documentTypesForPlatform("ios"), ["application/epub+zip"]);
    assert.deepEqual(documentTypesForPlatform("android"), [
        "application/epub+zip",
        "application/pdf",
    ]);
});

test("isPdfDocument recognizes MIME and mixed-case PDF names", () => {
    assert.equal(isPdfDocument("notes.txt", "application/pdf"), true);
    assert.equal(isPdfDocument("Chapter.PDF"), true);
    assert.equal(isPdfDocument("book.epub", "application/epub+zip"), false);
    assert.equal(isPdfDocument("book.epub"), false);
});
