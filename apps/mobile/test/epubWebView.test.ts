import assert from "node:assert/strict";
import test from "node:test";
import {
    chapterRenderDirectory,
    relativeUriWithinDirectory,
    rewriteChapterResourceSrcs,
} from "../src/lib/epubWebView.js";
import { chatOverlayBottom } from "../src/lib/keyboardInset.js";

test("relativeUriWithinDirectory strips a shared file root", () => {
    assert.equal(
        relativeUriWithinDirectory(
            "file:///docs/book/",
            "file:///docs/book/resources/img"
        ),
        "resources/img"
    );
    assert.equal(
        relativeUriWithinDirectory(
            "file:///docs/book",
            "file:///docs/other/img"
        ),
        null
    );
});

test("offline chapter render uses resources/ relative image paths", () => {
    const render = chapterRenderDirectory({
        offlineRootUri: "file:///docs/private/books/book-1/",
        cacheRootUri: "file:///cache/reader-resources/book-1/",
    });
    assert.equal(
        render.htmlFileUri,
        "file:///docs/private/books/book-1/chapter-view.html"
    );
    assert.equal(render.readAccessUri, "file:///docs/private/books/book-1/");
    assert.equal(
        render.resourceSrc("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        "resources/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
});

test("online chapter render keeps resources beside the HTML file", () => {
    const render = chapterRenderDirectory({
        offlineRootUri: null,
        cacheRootUri: "file:///cache/reader-resources/book-1/",
    });
    assert.equal(
        render.htmlFileUri,
        "file:///cache/reader-resources/book-1/chapter-view.html"
    );
    assert.equal(
        render.resourceSrc("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
});

test("rewriteChapterResourceSrcs injects relative src attributes", () => {
    const html =
        '<img data-reader-resource-id="cccccccccccccccccccccccccccccccc" alt="" />';
    assert.equal(
        rewriteChapterResourceSrcs(
            html,
            new Map([
                [
                    "cccccccccccccccccccccccccccccccc",
                    "resources/cccccccccccccccccccccccccccccccc",
                ],
            ])
        ),
        '<img src="resources/cccccccccccccccccccccccccccccccc" data-reader-resource-id="cccccccccccccccccccccccccccccccc" alt="" />'
    );
});

test("chatOverlayBottom lifts for the IME and rests above the home indicator", () => {
    assert.equal(
        chatOverlayBottom({
            keyboardHeight: 320,
            safeBottom: 34,
            restingGap: 16,
            keyboardGap: 8,
        }),
        328
    );
    assert.equal(
        chatOverlayBottom({
            keyboardHeight: 0,
            safeBottom: 34,
            restingGap: 16,
        }),
        34
    );
    assert.equal(
        chatOverlayBottom({
            keyboardHeight: 0,
            safeBottom: 0,
            restingGap: 16,
        }),
        16
    );
});
