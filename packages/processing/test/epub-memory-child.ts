import JSZip from "jszip";
import { extractEpubChunks } from "../src/epubIngestion";

const createLargeSyntheticEpub = async () => {
    const zip = new JSZip();
    const chapters = Array.from({ length: 80 }, (_, index) => index + 1);
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>`
    );
    zip.file(
        "EPUB/content.opf",
        `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Synthetic memory fixture</dc:title><dc:identifier>reader-memory-fixture</dc:identifier></metadata><manifest>${chapters.map((chapter) => `<item id="chapter-${chapter}" href="chapter-${chapter}.xhtml" media-type="application/xhtml+xml" />`).join("")}</manifest><spine>${chapters.map((chapter) => `<itemref idref="chapter-${chapter}" />`).join("")}</spine></package>`
    );
    const paragraph =
        "Synthetic content exercises bounded EPUB extraction without retaining uploaded or copyrighted material. ";
    for (const chapter of chapters) {
        zip.file(
            `EPUB/chapter-${chapter}.xhtml`,
            `<html xmlns="http://www.w3.org/1999/xhtml"><body><section>${Array.from({ length: 80 }, (_, index) => `<p>Chapter ${chapter}, paragraph ${index + 1}. ${paragraph.repeat(4)}</p>`).join("")}</section></body></html>`
        );
    }
    return zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
    });
};

async function main() {
    const buffer = await createLargeSyntheticEpub();
    const chunks = await extractEpubChunks(buffer);
    if (!chunks || chunks.length === 0) {
        throw new Error("No chunks extracted from EPUB fixture");
    }
    console.log(`EPUB_EXTRACTION_OK:${chunks.length}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
