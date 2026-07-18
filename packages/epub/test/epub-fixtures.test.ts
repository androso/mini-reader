import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
    buildTextBlocksFromDocument,
    sanitizeEpubHtml,
} from "../src/chapterProcessing";
import { processEpubFile } from "../src/processing";
import {
    findManifestEntryByHref,
    resolveTocHrefToSpineId,
    splitEpubHref,
} from "../src/navigation";
import type { EpubContent, ManifestItem } from "../src/types";

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

const fixtures = [
    {
        name: "google-docs-upskilling",
        fileName: "epub-3fe748bb63c9",
        expectedTitle: "Advice on Upskilling",
        minSpineItems: 1,
        minTocEntries: 150,
        requiresAnchors: true,
    },
    {
        name: "dopamine-nation",
        fileName: "epub-bacadba17183",
        expectedTitle:
            "Dopamine Nation: Finding Balance in the Age of Indulgence",
        minSpineItems: 20,
        minTocEntries: 20,
        requiresAnchors: false,
    },
];

const fixturePath = (fileName: string) =>
    path.resolve(process.cwd(), "../../.local-storage", fileName);

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
    buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

const loadFixture = async (fileName: string) => {
    const fileBuffer = await readFile(fixturePath(fileName));
    return processEpubFile(toArrayBuffer(fileBuffer));
};

const zipPathForManifestItem = (epubContent: EpubContent, item: ManifestItem) =>
    `${epubContent.basePath}${item.href}`;

test("EPUB fixtures process into metadata, spine, manifest, and ToC", async (t) => {
    for (const fixture of fixtures) {
        await t.test(fixture.name, async () => {
            const [epubContent, zipData] = await loadFixture(fixture.fileName);

            assert.equal(epubContent.metadata.title, fixture.expectedTitle);
            assert.ok(epubContent.spine.length >= fixture.minSpineItems);
            assert.ok(epubContent.toc.length >= fixture.minTocEntries);

            for (const spineId of epubContent.spine) {
                const manifestItem = epubContent.manifest[spineId];
                assert.ok(manifestItem, `missing manifest item for ${spineId}`);
                assert.ok(
                    zipData.file(
                        zipPathForManifestItem(epubContent, manifestItem)
                    ),
                    `missing spine file for ${spineId}`
                );
            }

            assert.ok(
                epubContent.toc.every((entry) => entry.title.trim().length > 0)
            );
        });
    }
});

test("ToC entries resolve to spine items and existing anchors", async (t) => {
    for (const fixture of fixtures) {
        await t.test(fixture.name, async () => {
            const [epubContent, zipData] = await loadFixture(fixture.fileName);
            const documentCache = new Map<string, Document>();
            let anchoredEntries = 0;

            for (const tocEntry of epubContent.toc) {
                assert.ok(tocEntry.href, `missing href for ${tocEntry.title}`);
                assert.ok(
                    resolveTocHrefToSpineId(epubContent, tocEntry.href),
                    `ToC href ${tocEntry.href} did not resolve to a spine item`
                );

                const { fragment } = splitEpubHref(tocEntry.href);
                if (!fragment) continue;

                anchoredEntries += 1;
                const manifestEntry = findManifestEntryByHref(
                    epubContent.manifest,
                    tocEntry.href
                );
                assert.ok(manifestEntry);

                let doc = documentCache.get(manifestEntry.id);
                if (!doc) {
                    const chapterFile = zipData.file(
                        zipPathForManifestItem(epubContent, manifestEntry.item)
                    );
                    assert.ok(chapterFile);
                    doc = new JSDOM(await chapterFile.async("text")).window
                        .document;
                    documentCache.set(manifestEntry.id, doc);
                }

                assert.ok(
                    doc.getElementById(fragment) ||
                        doc.getElementsByName(fragment).length > 0,
                    `missing anchor #${fragment} for ${tocEntry.href}`
                );
            }

            if (fixture.requiresAnchors) {
                assert.ok(anchoredEntries > 0);
            }
        });
    }
});

test("nested chapter containers split into readable text blocks", async () => {
    const [epubContent, zipData] = await loadFixture("epub-bacadba17183");
    const chapterId = "x08_Chapter_1_Our_Masturb";
    const manifestItem = epubContent.manifest[chapterId];
    assert.ok(manifestItem);

    const chapterFile = zipData.file(
        zipPathForManifestItem(epubContent, manifestItem)
    );
    assert.ok(chapterFile);

    const doc = new JSDOM(await chapterFile.async("text")).window.document;
    const directBodyChildren = doc.body.children.length;
    const textBlocks = buildTextBlocksFromDocument(doc, chapterId);
    const longestBlockLength = Math.max(
        ...textBlocks.map(
            (block) =>
                block.element.textContent?.replace(/\s+/g, " ").trim().length ??
                0
        )
    );

    assert.equal(directBodyChildren, 1);
    assert.ok(textBlocks.length >= 100);
    assert.ok(textBlocks.length > directBodyChildren * 20);
    assert.ok(longestBlockLength < 1500);
});

test("EPUB HTML sanitizer strips event handlers and executable URLs", () => {
    const doc = new JSDOM(`
        <body>
            <p onclick="alert(1)" style="position:fixed" data-secret="value">
                <a href="javascript:alert(1)">direct</a>
                <a href="java&#x09;script:alert(1)">encoded</a>
                <a href="&#x0a; javascript:alert(1)">leading whitespace</a>
                <a href="vbscript:msgbox(1)">unknown protocol</a>
                <a href="file:///etc/passwd">local file</a>
                <a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">data link</a>
                <img src="javascript:alert(1)" onerror="alert(1)" alt="bad image">
                <img src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;" alt="bad data image">
            </p>
        </body>
    `).window.document;

    const sanitized = sanitizeEpubHtml(doc.body.innerHTML, doc);

    assert.doesNotMatch(
        sanitized,
        /onclick|onerror|style=|data-secret|javascript:|data:text\/html/i
    );
    assert.match(sanitized, /<a>direct<\/a>/);
    assert.match(sanitized, /<a>encoded<\/a>/);
    assert.match(sanitized, /<a>leading whitespace<\/a>/);
    assert.match(sanitized, /<a>unknown protocol<\/a>/);
    assert.match(sanitized, /<a>local file<\/a>/);
    assert.match(sanitized, /<img alt="bad image">/);
    assert.match(sanitized, /<img alt="bad data image">/);
});

test("EPUB HTML sanitizer removes nested and forbidden embedded payloads", () => {
    const doc = new JSDOM(`
        <body>
            <p>Safe text
                <object data="javascript:alert(1)"><embed src="payload"></object>
                <iframe srcdoc="<script>alert(1)</script>"></iframe>
                <svg><foreignObject><p>SVG payload</p></foreignObject></svg>
                <math><annotation-xml><script>alert(1)</script></annotation-xml></math>
                <template><img src="x" onerror="alert(1)">template payload</template>
                <video src="https://attacker.test/tracker.mp4"></video>
                <form action="https://attacker.test"><input name="secret"></form>
            </p>
        </body>
    `).window.document;

    const sanitized = sanitizeEpubHtml(doc.body.innerHTML, doc);

    assert.match(sanitized, /<p>Safe text/);
    assert.doesNotMatch(
        sanitized,
        /object|embed|iframe|svg|foreignobject|math|annotation-xml|template|video|form|input|payload|tracker/i
    );
});

test("EPUB HTML sanitizer preserves safe formatting and URL forms", () => {
    const doc = new JSDOM(`
        <body>
            <h2 id="heading">Heading</h2>
            <p class="intro">Read <strong>carefully</strong> and <a href="../notes.xhtml#one">notes</a>.</p>
            <ul><li><a href="https://example.test">web</a></li><li><a href="mailto:reader@example.test">mail</a></li></ul>
            <table><tbody><tr><th>Kind</th><td><a href="tel:+15551234567">phone</a></td></tr></tbody></table>
            <p><a href="blob:https://reader.test/id">blob</a><a href="data:image/png;base64,iVBORw0KGgo=">no data link</a><img src="data:image/png;base64,iVBORw0KGgo=" alt="cover" width="10"></p>
        </body>
    `).window.document;

    const sanitized = sanitizeEpubHtml(doc.body.innerHTML, doc);

    assert.match(sanitized, /<h2 id="heading">Heading<\/h2>/);
    assert.match(sanitized, /href="\.\.\/notes.xhtml#one"/);
    assert.match(sanitized, /href="https:\/\/example\.test"/);
    assert.match(sanitized, /href="mailto:reader@example\.test"/);
    assert.match(sanitized, /href="tel:\+15551234567"/);
    assert.match(sanitized, /href="blob:https:\/\/reader\.test\/id"/);
    assert.match(sanitized, /<a>no data link<\/a>/);
    assert.match(sanitized, /src="data:image\/png;base64,iVBORw0KGgo="/);
    assert.match(sanitized, /<table>/);
});

test("text block sanitization drops empty blocks without shifting later IDs", () => {
    const doc = new JSDOM(`
        <body>
            <p>First</p>
            <figure><svg><text>Removed</text></svg></figure>
            <p id="last" onmouseover="alert(1)">Last</p>
        </body>
    `).window.document;

    const textBlocks = buildTextBlocksFromDocument(doc, "chapter-1");

    assert.deepEqual(
        textBlocks.map(({ id }) => id),
        ["chapter-1-block-0", "chapter-1-block-2"]
    );
    assert.equal(textBlocks[1].content, '<p id="last">Last</p>');
});
