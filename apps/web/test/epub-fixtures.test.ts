import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildTextBlocksFromDocument } from "../src/lib/epubChapterProcessing";
import { processEpubFile } from "../src/lib/epubProcessing";
import {
    findManifestEntryByHref,
    resolveTocHrefToSpineId,
    splitEpubHref,
} from "../src/lib/epubNavigation";
import type { EpubContent, ManifestItem } from "../src/types/EpubReader";

const requireFromApi = createRequire(
    path.resolve(process.cwd(), "../api/package.json")
);
const { JSDOM } = requireFromApi("jsdom") as {
    JSDOM: new (
        source: string,
        options?: { contentType?: string }
    ) => { window: { document: Document } };
};

class TestDOMParser {
    parseFromString(source: string, mimeType: DOMParserSupportedType): Document {
        const contentType =
            mimeType === "text/html" ? "text/html" : "application/xml";
        return new JSDOM(source, { contentType }).window.document;
    }
}

(globalThis as typeof globalThis & { DOMParser: typeof DOMParser }).DOMParser =
    TestDOMParser as unknown as typeof DOMParser;

const fixturePath = (fileName: string) =>
    path.resolve(process.cwd(), "../../.local-storage", fileName);

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
        expectedTitle: "Dopamine Nation: Finding Balance in the Age of Indulgence",
        minSpineItems: 20,
        minTocEntries: 20,
        requiresAnchors: false,
    },
];

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
    buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

const loadFixture = async (fileName: string) => {
    const fileBuffer = await readFile(fixturePath(fileName));
    return processEpubFile(toArrayBuffer(fileBuffer));
};

const zipPathForManifestItem = (
    epubContent: EpubContent,
    item: ManifestItem
) => `${epubContent.basePath}${item.href}`;

test("EPUB fixtures process into metadata, spine, manifest, and ToC", async (t) => {
    for (const fixture of fixtures) {
        await t.test(fixture.name, async () => {
            const [epubContent, zipData] = await loadFixture(fixture.fileName);

            assert.equal(epubContent.metadata.title, fixture.expectedTitle);
            assert.ok(
                epubContent.spine.length >= fixture.minSpineItems,
                `expected at least ${fixture.minSpineItems} spine items`
            );
            assert.ok(
                epubContent.toc.length >= fixture.minTocEntries,
                `expected at least ${fixture.minTocEntries} ToC entries`
            );

            for (const spineId of epubContent.spine) {
                const manifestItem = epubContent.manifest[spineId];
                assert.ok(manifestItem, `missing manifest item for ${spineId}`);
                assert.ok(
                    zipData.file(zipPathForManifestItem(epubContent, manifestItem)),
                    `missing spine file for ${spineId}`
                );
            }

            assert.ok(
                epubContent.toc.every((entry) => entry.title.trim().length > 0),
                "expected every ToC entry to have a title"
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
                const spineId = resolveTocHrefToSpineId(
                    epubContent,
                    tocEntry.href
                );
                assert.ok(
                    spineId,
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

                let cachedDoc = documentCache.get(manifestEntry.id);
                if (!cachedDoc) {
                    const chapterFile = zipData.file(
                        zipPathForManifestItem(epubContent, manifestEntry.item)
                    );
                    assert.ok(chapterFile, `missing chapter file for ${tocEntry.href}`);
                    cachedDoc = new JSDOM(
                        await chapterFile.async("text")
                    ).window.document;
                    documentCache.set(manifestEntry.id, cachedDoc);
                }

                assert.ok(
                    cachedDoc.getElementById(fragment) ||
                        cachedDoc.getElementsByName(fragment).length > 0,
                    `missing anchor #${fragment} for ${tocEntry.href}`
                );
            }

            if (fixture.requiresAnchors) {
                assert.ok(
                    anchoredEntries > 0,
                    "fixture should include ToC anchors, not only chapter links"
                );
            }
        });
    }
});

test("nested chapter containers split into readable text blocks", async () => {
    const [epubContent, zipData] = await loadFixture("epub-bacadba17183");
    const chapterId = "x08_Chapter_1_Our_Masturb";
    const manifestItem = epubContent.manifest[chapterId];
    assert.ok(manifestItem);

    const chapterFile = zipData.file(zipPathForManifestItem(epubContent, manifestItem));
    assert.ok(chapterFile);

    const doc = new JSDOM(await chapterFile.async("text")).window.document;
    const directBodyChildren = doc.body.children.length;
    const textBlocks = buildTextBlocksFromDocument(doc, chapterId);
    const longestBlockLength = Math.max(
        ...textBlocks.map((block) =>
            block.element.textContent?.replace(/\s+/g, " ").trim().length ?? 0
        )
    );

    assert.equal(
        directBodyChildren,
        1,
        "fixture should preserve the single-wrapper chapter shape"
    );
    assert.ok(
        textBlocks.length >= 100,
        `expected paragraph-level blocks, got ${textBlocks.length}`
    );
    assert.ok(
        textBlocks.length > directBodyChildren * 20,
        "expected nested blocks to be extracted instead of one wrapper block"
    );
    assert.ok(
        longestBlockLength < 1500,
        `largest block is too large: ${longestBlockLength} characters`
    );
    assert.deepEqual(
        textBlocks.slice(0, 3).map((block) => block.id),
        [
            `${chapterId}-block-0`,
            `${chapterId}-block-1`,
            `${chapterId}-block-2`,
        ]
    );
});
