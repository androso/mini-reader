import assert from "node:assert/strict";
import test from "node:test";
import { isEpubBook, resolveBookFileKind } from "../src/lib/bookFileKind";

test("explicit fileType wins over title suffixes", () => {
    assert.equal(
        resolveBookFileKind({ fileType: "pdf", title: "story.epub" }),
        "pdf"
    );
    assert.equal(
        resolveBookFileKind({ fileType: "epub", title: "story.pdf" }),
        "epub"
    );
});

test("legacy missing fileType treats .epub titles as EPUB", () => {
    assert.equal(
        resolveBookFileKind({ fileType: null, title: "Old Book.epub" }),
        "epub"
    );
    assert.equal(isEpubBook({ title: "memoir.EPUB" }), true);
});

test("unknown books stay placeholders", () => {
    assert.equal(resolveBookFileKind({ title: "mystery.bin" }), "unknown");
    assert.equal(
        resolveBookFileKind({ fileType: null, title: "notes" }),
        "unknown"
    );
    assert.equal(isEpubBook({ fileType: null, title: "scan.pdf" }), false);
});
