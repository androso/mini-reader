import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import * as epubIndex from "../src/index";
import {
    findChapterByHref,
    getHrefMatchKeys,
    normalizeEpubHref,
    splitEpubHref,
} from "../src/navigation";
import {
    cleanHref,
    extractId,
    getBasePath,
    processEpubFile,
} from "../src/processing";
import {
    buildReaderPackage,
    extractEpubTextBlocks,
    processEpubBuffer,
} from "../src/server";
import { installDomParser } from "../src/serverDom";
import {
    isSupportedImageMediaType,
    mediaTypeFromPath,
    normalizeEpubPackagePath,
    normalizeImageMediaType,
    resolveChapterRelativePath,
    resolveEpubImageResource,
    findExactManifestEntryByHref,
} from "../src/resourcePath";
import { sanitizeEpubSvg } from "../src/svgSanitizer";
import { markChapterImagesForLazyLoad } from "../src/chapterProcessing";
import type { EpubContent } from "../src/types";

const requireFromApi = createRequire(
    path.resolve(process.cwd(), "../../apps/api/package.json")
);
const { JSDOM } = requireFromApi("jsdom") as {
    JSDOM: new (
        source: string,
        options?: { contentType?: string }
    ) => {
        window: {
            document: Document;
            close: () => void;
        };
    };
};

installDomParser();

const createBasicEpub = async (options?: {
    coverById?: boolean;
    includeMissingImage?: boolean;
    includeInlineSvg?: boolean;
    includeBrokenSvg?: boolean;
    hrefWithoutExtension?: boolean;
    skipChapterFile?: boolean;
    nestedNav?: boolean;
}) => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );

    const coverItem = options?.coverById
        ? `<item id="cover" href="Images/photo.jpg" media-type="image/jpeg"/>`
        : `<item id="cover-img" href="Images/photo.jpg" media-type="image/jpeg" properties="cover-image"/>`;

    const chapterHref = options?.hrefWithoutExtension
        ? "Text/chapter"
        : "Text/chapter.xhtml";

    zip.file(
        "EPUB/package.opf",
        `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Coverage</dc:title><dc:creator>Tests</dc:creator><dc:identifier>urn:test:coverage</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="${chapterHref}" media-type="application/xhtml+xml"/>${coverItem}<item id="ghost" href="Images/missing.png" media-type="image/png"/><item id="bad-svg" href="Images/bad.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="chapter"/><itemref idref="missing-spine"/></spine></package>`
    );

    const nested = options?.nestedNav
        ? `<li><a href="Text/chapter.xhtml#nested">Nested</a><ol><li><a href="Text/chapter.xhtml#deep">Deep</a></li></ol></li>`
        : "";

    zip.file(
        "EPUB/nav.xhtml",
        `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="Text/chapter.xhtml#start">Start</a></li>${nested}<li><span>No link</span></li></ol></nav></body></html>`
    );

    const inlineSvg = options?.includeInlineSvg
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><title>Inline</title><circle cx="4" cy="4" r="3"/></svg>`
        : "";
    const missingImg = options?.includeMissingImage
        ? `<img src="../Images/missing.png" alt="gone"/>`
        : "";
    const brokenSvgImg = options?.includeBrokenSvg
        ? `<img src="../Images/bad.svg" alt="bad"/>`
        : "";

    if (!options?.skipChapterFile) {
        zip.file(
            `EPUB/${chapterHref}${options?.hrefWithoutExtension ? "" : ""}`.replace(
                /\/{2,}/g,
                "/"
            ),
            `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="start">Start</h1><p id="nested">Nested body</p><p id="deep">Deep body</p><img src="../Images/photo.jpg" alt="cover"/>${missingImg}${brokenSvgImg}${inlineSvg}<p>Readable text.</p></body></html>`
        );
    }

    // minimal jpeg-ish bytes (not validated beyond being present)
    zip.file("EPUB/Images/photo.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    zip.file(
        "EPUB/Images/bad.svg",
        `<not-svg><script>alert(1)</script></not-svg>`
    );

    return zip.generateAsync({ type: "nodebuffer" });
};

const createNcxEpub = async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
        "OEBPS/content.opf",
        `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>NCX Book</dc:title><dc:creator>NCX Author</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.html" media-type="application/xhtml+xml"/><item id="c2" href="c2.html" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine></package>`
    );
    zip.file(
        "OEBPS/toc.ncx",
        `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="np1" playOrder="1"><navLabel><text>One</text></navLabel><content src="c1.html#frag"/><navPoint id="np1-child" playOrder="2"><navLabel><text>One Child</text></navLabel><content src="c1.html#child"/></navPoint></navPoint><navPoint id="np2" playOrder="3"><navLabel><text>Two</text></navLabel><content src="c2.html"/></navPoint></navMap></ncx>`
    );
    zip.file(
        "OEBPS/c1.html",
        `<html><body><h1 id="frag">One</h1><p id="child">Child</p></body></html>`
    );
    zip.file("OEBPS/c2.html", `<html><body><h1>Two</h1></body></html>`);
    return zip.generateAsync({ type: "nodebuffer" });
};

const createNavlessWithNcxFallback = async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    // OPF at root => empty basePath; nav points at empty xhtml so NCX fallback is used
    zip.file(
        "content.opf",
        `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fallback</dc:title></metadata><manifest><item id="nav" href="empty-nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`
    );
    zip.file(
        "empty-nav.xhtml",
        `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>no toc nav</p></body></html>`
    );
    zip.file(
        "toc.ncx",
        `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="a" playOrder="1"><navLabel><text>Alpha</text></navLabel><content src="c1.xhtml"/></navPoint></navMap></ncx>`
    );
    zip.file("c1.xhtml", `<html><body><p>Hi</p></body></html>`);
    return zip.generateAsync({ type: "nodebuffer" });
};

test("index re-exports core EPUB helpers", () => {
    assert.equal(typeof epubIndex.processEpubFile, "function");
    assert.equal(typeof epubIndex.sanitizeEpubSvg, "function");
    assert.equal(typeof epubIndex.buildChapterOrder, "function");
    assert.equal(typeof epubIndex.normalizeEpubPackagePath, "function");
    assert.equal(typeof epubIndex.findChapterByHref, "function");
    assert.equal(typeof epubIndex.resolveChapterIdFromProgress, "function");
});

test("server processEpubBuffer and extractEpubTextBlocks cover spine branches", async () => {
    const buffer = await createBasicEpub({
        nestedNav: true,
        hrefWithoutExtension: true,
    });
    const [content, zip] = await processEpubBuffer(buffer);
    assert.equal(content.metadata.title, "Coverage");
    assert.ok(zip.file("EPUB/Text/chapter"));

    const extracted = await extractEpubTextBlocks(buffer);
    assert.equal(extracted.content.metadata.title, "Coverage");
    assert.ok(extracted.chapters.length >= 1);
    assert.equal(extracted.chapters[0]?.hrefId, "Text/chapter");

    const withExt = await extractEpubTextBlocks(await createBasicEpub());
    assert.equal(withExt.chapters[0]?.hrefId, "Text/chapter");
    assert.ok(
        extracted.chapters[0]?.textBlocks.some((block) =>
            block.text.includes("Readable text")
        )
    );

    const packaged = await buildReaderPackage(buffer);
    assert.ok(packaged.chapters.length >= 1);
    assert.ok(packaged.resources.length >= 1);
});

test("navigation helpers cover decode failures, fragments, and chapter lookup", () => {
    assert.deepEqual(splitEpubHref(null), { path: "", fragment: null });
    assert.deepEqual(splitEpubHref("a.xhtml?x=1#frag"), {
        path: "a.xhtml",
        fragment: "frag",
    });

    assert.equal(
        normalizeEpubHref("%E0%A4%A", { preserveFragment: false }),
        "%E0%A4%A"
    );
    assert.equal(
        normalizeEpubHref("./Text/../Text/./chapter.xhtml#x", {
            preserveFragment: true,
        }),
        "Text/chapter#x"
    );
    assert.deepEqual(
        [...getHrefMatchKeys("Text/chapter.xhtml")],
        ["Text/chapter", "chapter"]
    );

    const chapters = [
        { id: "chapter-1", hrefId: "Text/chapter-1" },
        {
            id: "nested/chapter-2",
            hrefId: "nested/chapter-2",
            textBlocks: [{ id: "b", content: "<p>x</p>", text: "x" }],
        },
    ];
    assert.equal(
        findChapterByHref(chapters, "Text/chapter-1.xhtml")?.id,
        "chapter-1"
    );
    assert.equal(
        findChapterByHref(chapters, "chapter-2.xhtml")?.id,
        "nested/chapter-2"
    );
    assert.equal(findChapterByHref(chapters, "missing.xhtml"), undefined);
});

test("processing helpers and EPUB2 NCX / error paths", async () => {
    assert.equal(getBasePath("OEBPS/content.opf"), "OEBPS/");
    assert.equal(getBasePath("content.opf"), "");
    assert.equal(extractId(""), "");
    assert.equal(cleanHref("a/b.xhtml#frag"), "a/b#frag");

    const ncxBuffer = await createNcxEpub();
    const [ncxContent] = await processEpubBuffer(ncxBuffer);
    assert.equal(ncxContent.metadata.title, "NCX Book");
    assert.ok(ncxContent.toc.some((entry) => entry.title === "One"));
    assert.ok(ncxContent.toc.some((entry) => entry.title === "One Child"));
    assert.ok(ncxContent.toc.some((entry) => entry.playOrder === 1));

    const fallbackBuffer = await createNavlessWithNcxFallback();
    const [fallbackContent] = await processEpubBuffer(fallbackBuffer);
    assert.equal(fallbackContent.basePath, "");
    assert.ok(fallbackContent.toc.some((entry) => entry.title === "Alpha"));

    await assert.rejects(
        processEpubFile(
            await new JSZip().generateAsync({ type: "arraybuffer" })
        ),
        /container\.xml not found/
    );

    const missingOpfPath = new JSZip();
    missingOpfPath.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles></rootfiles></container>`
    );
    await assert.rejects(
        processEpubFile(
            await missingOpfPath.generateAsync({ type: "arraybuffer" })
        ),
        /OPF path not found/
    );

    const missingOpfFile = new JSZip();
    missingOpfFile.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="missing.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    await assert.rejects(
        processEpubFile(
            await missingOpfFile.generateAsync({ type: "arraybuffer" })
        ),
        /OPF file not found/
    );
});

test("readerPackage covers missing resources, inline svg, and cover-by-id", async () => {
    const buffer = await createBasicEpub({
        coverById: true,
        includeMissingImage: true,
        includeInlineSvg: true,
        includeBrokenSvg: true,
        nestedNav: true,
    });
    const pkg = await buildReaderPackage(buffer);
    assert.ok(pkg.coverResourceId);
    assert.ok(pkg.resources.some((resource) => resource.isCover));
    assert.ok(
        pkg.resources.some((resource) => resource.mediaType === "image/svg+xml")
    );
    assert.ok(pkg.toc.some((entry) => entry.blockId?.includes("block-")));
    assert.ok(
        pkg.chapters[0]?.blocks.some((block) =>
            block.html.includes("data-reader-resource-id")
        )
    );

    const skipped = await createBasicEpub({ skipChapterFile: true });
    const emptyChapters = await buildReaderPackage(skipped);
    assert.equal(emptyChapters.chapters.length, 0);
});

test("resourcePath covers decode failures and media-type branches", () => {
    assert.equal(
        normalizeEpubPackagePath("%E0%A4%A/photo.jpg"),
        "%E0%A4%A/photo.jpg"
    );
    assert.equal(normalizeEpubPackagePath(""), null);
    assert.equal(normalizeEpubPackagePath("."), "");
    assert.equal(mediaTypeFromPath("x.GIF"), "image/gif");
    assert.equal(mediaTypeFromPath("x.bin"), null);
    assert.equal(normalizeImageMediaType("image/SVG"), "image/svg+xml");
    assert.equal(normalizeImageMediaType("image/jpg"), "image/jpeg");
    assert.equal(isSupportedImageMediaType("image/png"), true);
    assert.equal(isSupportedImageMediaType("text/plain"), false);
    assert.equal(
        resolveChapterRelativePath("/images/a.jpg", "text/c.xhtml"),
        "images/a.jpg"
    );
    assert.equal(
        resolveChapterRelativePath("data:image/png;base64,xx", "text/c.xhtml"),
        null
    );
    assert.equal(
        resolveChapterRelativePath("blob:https://x", "text/c.xhtml"),
        null
    );

    const epub: EpubContent = {
        metadata: { title: "t", creator: "c" },
        basePath: "OEBPS",
        spine: ["c1"],
        manifest: {
            c1: {
                href: "text/c1.xhtml",
                mediaType: "application/xhtml+xml",
                properties: null,
            },
            only: {
                href: "images/unique.png",
                mediaType: "image/png",
                properties: null,
            },
            bad: {
                href: "images/notes.txt",
                mediaType: "text/plain",
                properties: null,
            },
        },
        toc: [],
    };
    assert.equal(
        findExactManifestEntryByHref(epub.manifest, "unique.png")?.id,
        "only"
    );
    assert.equal(
        resolveEpubImageResource(epub, "text/c1.xhtml", "../images/unique.png")
            ?.zipPath,
        "OEBPS/images/unique.png"
    );
    assert.equal(
        resolveEpubImageResource(epub, "text/c1.xhtml", "../images/notes.txt"),
        null
    );
});

test("svgSanitizer covers style CSS, empty input, and residual cleanup", () => {
    const doc = new JSDOM("<!doctype html><html><body></body></html>").window
        .document;

    assert.equal(sanitizeEpubSvg("   ", doc), null);
    assert.equal(sanitizeEpubSvg("<div>not svg</div>", doc), null);

    const withStyle = sanitizeEpubSvg(
        `<svg viewBox="0 0 10 10" style="color: red; expression(alert(1)); background: url(https://evil); fill: url(#ok)">
            <unknown-tag/>
            <rect width="10" height="10" href="https://evil.test/x" xlink:href="#ok" style="opacity: 1; @import 'x'; behavior: url(x); color: blue"/>
            <image href="data:image/png;base64,abc"/>
            <image href=""/>
         </svg>`,
        doc
    );
    assert.ok(withStyle);
    assert.doesNotMatch(
        withStyle!,
        /expression|evil|@import|behavior|unknown-tag/i
    );
    assert.match(withStyle!, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

    const htmlFallback = sanitizeEpubSvg(
        `<svg><script>bad()</script><circle cx="1" cy="1" r="1"/></svg>`,
        doc
    );
    assert.ok(htmlFallback);
    assert.doesNotMatch(htmlFallback!, /script/i);
});

test("chapterProcessing covers existing markers and svg removal branches", () => {
    const doc = new JSDOM(`
      <body>
        <img data-epub-src="images/a.jpg" data-epub-mime="image/jpeg" />
        <img src="blob:https://local/1" alt="blob"/>
        <img src="../images/missing.jpg" alt="miss"/>
        <svg></svg>
      </body>
    `).window.document;

    markChapterImagesForLazyLoad(doc, () => null);
    assert.equal(
        doc.querySelector("img[data-epub-src]")?.getAttribute("loading"),
        "lazy"
    );
    assert.equal(doc.querySelectorAll("svg").length, 0);
    assert.equal(
        doc.querySelector('img[alt="blob"]')?.getAttribute("src"),
        null
    );
});

test("serverDom installDomParser is idempotent and parses html mime", () => {
    installDomParser();
    installDomParser();
    const parsed = new DOMParser().parseFromString(
        "<html><body><p>hi</p></body></html>",
        "text/html"
    );
    assert.equal(parsed.querySelector("p")?.textContent, "hi");
});
