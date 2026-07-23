import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import {
    extractEpubCover,
    type EpubCoverExtractionResult,
} from "../src/lib/epubCoverExtraction";

const requireFromEpub = createRequire(
    path.resolve(process.cwd(), "../../packages/epub/package.json")
);
const { JSDOM } = requireFromEpub("jsdom") as {
    JSDOM: new (
        source: string,
        options?: { contentType?: string }
    ) => { window: { document: Document } };
};

const parseXml = (source: string, mimeType: string) => {
    const contentType =
        mimeType === "text/html" ? "text/html" : "application/xml";
    return new JSDOM(source, { contentType }).window.document;
};

const TINY_JPEG = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

type FixtureOptions = {
    opfPath?: string;
    opfBody: string;
    files?: Record<string, string | Uint8Array>;
};

const buildEpub = async ({
    opfPath = "OEBPS/content.opf",
    opfBody,
    files = {},
}: FixtureOptions) => {
    const zip = new JSZip();
    zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    );
    zip.file(opfPath, opfBody);
    for (const [name, content] of Object.entries(files)) {
        zip.file(name, content);
    }
    return zip.generateAsync({ type: "uint8array" });
};

const assertCover = async (
    bytes: Uint8Array,
    expectedPathPart: string
): Promise<Extract<EpubCoverExtractionResult, { status: "cover" }>> => {
    const result = await extractEpubCover(bytes.buffer as ArrayBuffer, {
        parseXml,
    });
    assert.equal(result.status, "cover");
    if (result.status !== "cover") throw new Error("expected cover");
    assert.match(result.path, new RegExp(expectedPathPart));
    assert.equal(result.mediaType, "image/jpeg");
    assert.ok(result.blob.size > 0);
    return result;
};

test("extracts EPUB 3 cover-image metadata", async () => {
    const bytes = await buildEpub({
        opfBody: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>EPUB3</dc:title>
  </metadata>
  <manifest>
    <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="chap" href="text/chap.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap"/>
  </spine>
</package>`,
        files: {
            "OEBPS/images/cover.jpg": TINY_JPEG,
            "OEBPS/text/chap.xhtml": "<html><body>hi</body></html>",
        },
    });

    await assertCover(bytes, "images/cover\\.jpg$");
});

test("extracts EPUB 2 meta[name=cover] manifest target", async () => {
    const bytes = await buildEpub({
        opfBody: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>EPUB2</dc:title>
    <meta name="cover" content="cover-id"/>
  </metadata>
  <manifest>
    <item id="cover-id" href="Images/MyCover.jpg" media-type="image/jpeg"/>
    <item id="chap" href="chap.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap"/>
  </spine>
</package>`,
        files: {
            "OEBPS/Images/MyCover.jpg": TINY_JPEG,
            "OEBPS/chap.xhtml": "<html><body>hi</body></html>",
        },
    });

    await assertCover(bytes, "Images/MyCover\\.jpg$");
});

test("extracts guide-based XHTML covers with nested relative images", async () => {
    const bytes = await buildEpub({
        opfBody: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Guide Cover</dc:title>
  </metadata>
  <manifest>
    <item id="cover-html" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-img" href="images/nested/cover.jpg" media-type="image/jpeg"/>
    <item id="chap" href="text/chap.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover-html"/>
    <itemref idref="chap"/>
  </spine>
  <guide>
    <reference type="cover" title="Cover" href="text/cover.xhtml"/>
  </guide>
</package>`,
        files: {
            "OEBPS/text/cover.xhtml":
                '<html><body><img src="../images/nested/cover.jpg" alt="Cover"/></body></html>',
            "OEBPS/images/nested/cover.jpg": TINY_JPEG,
            "OEBPS/text/chap.xhtml": "<html><body>hi</body></html>",
        },
    });

    await assertCover(bytes, "images/nested/cover\\.jpg$");
});

test("resolves encoded cover filenames in nested folders", async () => {
    const encodedName = "cover%20art.jpg";
    const bytes = await buildEpub({
        opfBody: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Encoded</dc:title>
  </metadata>
  <manifest>
    <item id="cover" href="arts/${encodedName}" media-type="image/jpeg" properties="cover-image"/>
    <item id="chap" href="text/chap.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap"/>
  </spine>
</package>`,
        files: {
            [`OEBPS/arts/${encodedName}`]: TINY_JPEG,
            "OEBPS/text/chap.xhtml": "<html><body>hi</body></html>",
        },
    });

    const result = await assertCover(bytes, "arts/");
    assert.equal(result.mediaType, "image/jpeg");
});

test("missing covers return a classified missing state", async () => {
    const bytes = await buildEpub({
        opfBody: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>No Cover</dc:title>
  </metadata>
  <manifest>
    <item id="chap" href="text/chap.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap"/>
  </spine>
</package>`,
        files: {
            "OEBPS/text/chap.xhtml": "<html><body>hi</body></html>",
        },
    });

    const result = await extractEpubCover(bytes.buffer as ArrayBuffer, {
        parseXml,
    });
    assert.equal(result.status, "missing");
});

test("invalid image media types do not become cover blobs", async () => {
    const bytes = await buildEpub({
        opfBody: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Bad MIME</dc:title>
  </metadata>
  <manifest>
    <item id="cover" href="images/cover.bin" media-type="application/octet-stream" properties="cover-image"/>
    <item id="chap" href="text/chap.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap"/>
  </spine>
</package>`,
        files: {
            "OEBPS/images/cover.bin": TINY_JPEG,
            "OEBPS/text/chap.xhtml": "<html><body>hi</body></html>",
        },
    });

    const result = await extractEpubCover(bytes.buffer as ArrayBuffer, {
        parseXml,
    });
    assert.equal(result.status, "invalid");
});

test("broken EPUB archives return invalid", async () => {
    const result = await extractEpubCover(new Blob(["not-an-epub"]), {
        parseXml,
    });
    assert.equal(result.status, "invalid");
});
