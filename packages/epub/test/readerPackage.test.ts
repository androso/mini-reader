import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { buildReaderPackage } from "../src/readerPackage";
import { extractEpubCoverBuffer } from "../src/server";

const fixture = async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
        "EPUB/package.opf",
        `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Package fixture</dc:title><dc:creator>Reader tests</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="image" href="Images/cover.svg" media-type="image/svg+xml" properties="cover-image"/></manifest><spine><itemref idref="chapter"/></spine></package>`
    );
    zip.file(
        "EPUB/nav.xhtml",
        `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="Text/chapter.xhtml#start">Start</a></li></ol></nav></body></html>`
    );
    zip.file(
        "EPUB/Text/chapter.xhtml",
        `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="start">Start</h1><img src="../Images/cover.svg" onerror="alert(1)"/><script>alert(1)</script><p onclick="alert(1)">Safe words.</p><img src="https://tracker.example/pixel.png"/></body></html>`
    );
    zip.file(
        "EPUB/Images/cover.svg",
        `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10"/></svg>`
    );
    return zip.generateAsync({ type: "nodebuffer" });
};

test("reader packages are deterministic, sanitized, and preserve nested resources", async () => {
    const source = await fixture();
    const first = await buildReaderPackage(source);
    const second = await buildReaderPackage(source);

    assert.equal(first.chapters.length, 1);
    assert.equal(first.resources.length, 1);
    assert.equal(first.coverResourceId, first.resources[0]?.id);
    assert.equal(first.resources[0]?.id, second.resources[0]?.id);
    assert.match(
        first.chapters[0]?.blocks.map((block) => block.text).join(" ") ?? "",
        /Safe words/
    );
    const html =
        first.chapters[0]?.blocks.map((block) => block.html).join("") ?? "";
    assert.doesNotMatch(html, /script|onerror|onclick|tracker\.example/i);
    assert.match(html, /data-reader-resource-id/);
    assert.doesNotMatch(
        Buffer.from(first.resources[0]?.bytes ?? []).toString("utf8"),
        /script|onload/i
    );
    assert.equal(first.toc[0]?.chapterId, "chapter");
});

test("extracts an EPUB 2 metadata cover outside the spine", async () => {
    const zip = new JSZip();
    zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`
    );
    zip.file(
        "content.opf",
        `<package version="2.0"><metadata><title>Legacy</title><meta name="cover" content="cover-art"/></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="cover-art" href="images/art.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="chapter"/></spine></package>`
    );
    zip.file("chapter.xhtml", "<html><body><p>Text</p></body></html>");
    zip.file("images/art.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const cover = await extractEpubCoverBuffer(
        await zip.generateAsync({ type: "nodebuffer" })
    );
    assert.equal(cover?.mediaType, "image/jpeg");
    assert.deepEqual(cover?.bytes, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
});
