import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import {
    buildTextBlocksFromDocument,
    markChapterImagesForLazyLoad,
    sanitizeEpubHtml,
} from "../src/chapterProcessing";
import { resolveEpubImageResource } from "../src/resourcePath";
import type { EpubContent } from "../src/types";

const requireFromApi = createRequire(
    path.resolve(process.cwd(), "../../apps/api/package.json")
);
const { JSDOM } = requireFromApi("jsdom") as {
    JSDOM: new (
        source: string,
        options?: { contentType?: string }
    ) => { window: { document: Document } };
};

class TestDOMParser {
    parseFromString(
        source: string,
        mimeType: DOMParserSupportedType
    ): Document {
        const contentType =
            mimeType === "text/html" ? "text/html" : "application/xml";
        return new JSDOM(source, { contentType }).window.document;
    }
}

(globalThis as typeof globalThis & { DOMParser: typeof DOMParser }).DOMParser =
    TestDOMParser as unknown as typeof DOMParser;

const epubContent = (): EpubContent => ({
    metadata: { title: "T", creator: "A" },
    basePath: "OEBPS/",
    spine: ["c1"],
    manifest: {
        c1: {
            href: "text/c1.xhtml",
            mediaType: "application/xhtml+xml",
            properties: null,
        },
        img1: {
            href: "images/a.jpg",
            mediaType: "image/jpeg",
            properties: null,
        },
    },
    toc: [],
});

test("markChapterImagesForLazyLoad sets markers and strips remote sources", () => {
    const doc = new JSDOM(`
      <body>
        <p><img src="../images/a.jpg" alt="A" width="120" height="80" /></p>
        <p><img src="https://evil.test/x.png" alt="remote" /></p>
        <p><img src="data:image/png;base64,aaaa" alt="data" /></p>
      </body>
    `).window.document;

    markChapterImagesForLazyLoad(doc, (src) =>
        resolveEpubImageResource(epubContent(), "text/c1.xhtml", src)
    );

    const imgs = Array.from(doc.querySelectorAll("img"));
    assert.equal(imgs[0].getAttribute("data-epub-src"), "images/a.jpg");
    assert.equal(imgs[0].getAttribute("data-epub-mime"), "image/jpeg");
    assert.equal(imgs[0].getAttribute("src"), null);
    assert.equal(imgs[0].getAttribute("loading"), "lazy");
    assert.equal(imgs[1].getAttribute("src"), null);
    assert.equal(
        imgs[2].getAttribute("src")?.startsWith("data:image/png"),
        true
    );
});

test("figures with captions and standalone images survive block extraction", () => {
    const doc = new JSDOM(`
      <body>
        <figure>
          <img data-epub-src="images/a.jpg" data-epub-mime="image/jpeg" alt="Fig" width="10" height="10" />
          <figcaption>A caption</figcaption>
        </figure>
        <img data-epub-src="images/a.jpg" data-epub-mime="image/jpeg" alt="Solo" />
        <p>Text with <img data-epub-src="images/a.jpg" data-epub-mime="image/jpeg" alt="inline" /> inside.</p>
      </body>
    `).window.document;

    const blocks = buildTextBlocksFromDocument(doc, "c1");
    assert.ok(blocks.length >= 3);
    assert.ok(
        blocks.some(
            (b) =>
                b.content.includes("<figure") && b.content.includes("A caption")
        )
    );
    assert.ok(blocks.some((b) => b.content.includes('alt="Solo"')));
    assert.ok(
        blocks.some(
            (b) =>
                b.content.includes("Text with") && b.content.includes("inline")
        )
    );
    assert.ok(
        blocks.every(
            (b) =>
                !b.content.includes("https://") || b.content.includes("mailto")
        )
    );
});

test("sanitizer preserves image markers and rejects http image src", () => {
    const doc = new JSDOM("<!doctype html><html><body></body></html>").window
        .document;
    const html = sanitizeEpubHtml(
        `<img src="https://evil.test/a.jpg" data-epub-src="images/a.jpg" data-epub-mime="image/jpeg" alt="x" loading="lazy" decoding="async" width="1" height="1" />`,
        doc
    );
    assert.doesNotMatch(html, /https:\/\/evil/);
    assert.match(html, /data-epub-src="images\/a\.jpg"/);
    assert.match(html, /loading="lazy"/);
});

test("inline SVG is converted to a sanitized img marker", () => {
    const doc = new JSDOM(`
      <body>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onclick="alert(1)">
          <script>bad()</script>
          <circle cx="5" cy="5" r="4" />
        </svg>
      </body>
    `).window.document;

    markChapterImagesForLazyLoad(doc, () => null);
    const img = doc.querySelector("img");
    assert.ok(img);
    assert.equal(img!.getAttribute("data-epub-mime"), "image/svg+xml");
    const payload = img!.getAttribute("data-epub-svg") || "";
    assert.match(payload, /<circle/);
    assert.doesNotMatch(payload, /script|onclick/i);
});

test("infinity-style cover xhtml keeps the cover image block", () => {
    const coverHtml = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
<div id="cover-image">
<img alt="Cover Image for The Beginning of Infinity" id="cover1" src="../images/cover.jpg"/>
</div>
</body>
</html>`;

    // Reader parses chapters as text/html.
    const { window } = new JSDOM(coverHtml, { contentType: "text/html" });
    const doc = window.document;
    const epubContent: EpubContent = {
        metadata: { title: null, creator: null, identifier: null },
        spine: ["cover"],
        manifest: {
            cover: {
                href: "xhtml/cover.html",
                mediaType: "application/xhtml+xml",
                properties: null,
            },
            "cover-image": {
                href: "images/cover.jpg",
                mediaType: "image/jpeg",
                properties: null,
            },
        },
        basePath: "TheBeginningofInfinity/",
        toc: [],
    };

    markChapterImagesForLazyLoad(doc, (src) =>
        resolveEpubImageResource(epubContent, "xhtml/cover.html", src)
    );
    const blocks = buildTextBlocksFromDocument(doc, "cover");
    assert.equal(blocks.length, 1);
    assert.match(
        blocks[0]?.content ?? "",
        /data-epub-src="images\/cover\.jpg"/
    );
    assert.match(blocks[0]?.content ?? "", /data-epub-mime="image\/jpeg"/);
});

test("sanitize keeps cover img even when xmlns is present on outerHTML", () => {
    const { window } = new JSDOM("<html><body></body></html>", {
        contentType: "text/html",
    });
    const doc = window.document;
    const dirty =
        '<img xmlns="http://www.w3.org/1999/xhtml" alt="Cover" data-epub-src="images/cover.jpg" data-epub-mime="image/jpeg" loading="lazy" decoding="async" />';
    const sanitized = sanitizeEpubHtml(dirty, doc);
    assert.match(sanitized, /data-epub-src="images\/cover\.jpg"/);
    assert.match(sanitized, /<img/i);
});
