import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildTextBlocksFromDocument } from "../src/chapterProcessing";
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
