import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import {
    EPUB_IMAGE_MARKER_ATTRIBUTE,
    buildTextBlocksFromDocument,
    getReadableBlockElements,
    markChapterImagesForLazyLoad,
    sanitizeEpubHtml,
} from "../src/lib/epubChapterProcessing";

const requireFromEpub = createRequire(
    path.resolve(process.cwd(), "../../packages/epub/package.json")
);
const { JSDOM } = requireFromEpub("jsdom") as {
    JSDOM: new (
        source: string,
        options?: { contentType?: string }
    ) => { window: { document: Document; DOMParser: typeof DOMParser } };
};

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
(globalThis as typeof globalThis & { DOMParser: typeof DOMParser }).DOMParser =
    dom.window.DOMParser;

test("epubChapterProcessing re-exports sanitize and marker helpers", () => {
    const doc = new JSDOM(
        `<body><p>Hello <script>alert(1)</script><img src="a.jpg" /></p></body>`
    ).window.document;

    const sanitized = sanitizeEpubHtml(
        `<p>Hello <script>alert(1)</script></p>`,
        doc
    );
    assert.equal(sanitized.includes("script"), false);
    assert.equal(sanitized.includes("Hello"), true);
    assert.equal(typeof EPUB_IMAGE_MARKER_ATTRIBUTE, "object");
    assert.ok(EPUB_IMAGE_MARKER_ATTRIBUTE);
});

test("epubChapterProcessing builds readable blocks from chapter HTML", () => {
    const doc = new JSDOM(`
      <body>
        <p>First paragraph.</p>
        <p>Second paragraph.</p>
      </body>
    `).window.document;

    const readable = getReadableBlockElements(doc);
    assert.ok(readable.length >= 2);

    const blocks = buildTextBlocksFromDocument(doc, "chapter-1");
    assert.ok(blocks.length >= 2);
    assert.ok(blocks.every((block) => block.id.startsWith("chapter-1-block-")));
});

test("epubChapterProcessing marks chapter images for lazy load", () => {
    const doc = new JSDOM(`
      <body>
        <p><img src="../images/a.jpg" alt="A" width="10" height="10" /></p>
      </body>
    `).window.document;

    markChapterImagesForLazyLoad(doc, (src) =>
        src.includes("a.jpg")
            ? {
                  zipPath: "OEBPS/images/a.jpg",
                  manifestHref: "images/a.jpg",
                  manifestId: "img1",
                  mediaType: "image/jpeg",
              }
            : null
    );

    const img = doc.querySelector("img");
    assert.ok(img);
    assert.equal(img.getAttribute("src"), null);
    assert.equal(img.getAttribute("data-epub-src"), "images/a.jpg");
    assert.equal(img.getAttribute("data-epub-mime"), "image/jpeg");
    assert.equal(img.getAttribute("loading"), "lazy");
});
