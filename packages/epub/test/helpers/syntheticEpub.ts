import JSZip from "jszip";

interface SyntheticEpubOptions {
    title: string;
    chapterCount: number;
    tocEntries?: number;
    nestedParagraphs?: number;
    anchors?: boolean;
}

const xmlEscape = (value: string) =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

export const createSyntheticEpub = async ({
    title,
    chapterCount,
    tocEntries = chapterCount,
    nestedParagraphs = 4,
    anchors = false,
}: SyntheticEpubOptions): Promise<Buffer> => {
    const zip = new JSZip();
    const chapters = Array.from(
        { length: chapterCount },
        (_, index) => index + 1
    );

    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
    );

    const manifest = chapters
        .map(
            (chapter) =>
                `<item id="chapter-${chapter}" href="chapter-${chapter}.xhtml" media-type="application/xhtml+xml" />`
        )
        .join("\n    ");
    const spine = chapters
        .map((chapter) => `<itemref idref="chapter-${chapter}" />`)
        .join("\n    ");

    zip.file(
        "EPUB/content.opf",
        `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:reader-synthetic-fixture</dc:identifier>
    <dc:title>${xmlEscape(title)}</dc:title>
    <dc:creator>Reader Platform test suite</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`
    );

    const navigation = Array.from({ length: tocEntries }, (_, index) => {
        const chapter = (index % chapterCount) + 1;
        const fragment = anchors ? `#section-${index + 1}` : "";
        return `<li><a href="chapter-${chapter}.xhtml${fragment}">Section ${index + 1}</a></li>`;
    }).join("\n        ");

    zip.file(
        "EPUB/nav.xhtml",
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body><nav epub:type="toc"><ol>${navigation}</ol></nav></body>
</html>`
    );

    for (const chapter of chapters) {
        const chapterAnchors = anchors
            ? Array.from({ length: tocEntries }, (_, index) => index + 1)
                  .filter((entry) => (entry - 1) % chapterCount === chapter - 1)
                  .map(
                      (entry) =>
                          `<p id="section-${entry}">Synthetic anchored section ${entry}.</p>`
                  )
                  .join("\n")
            : "";
        const paragraphs = Array.from(
            { length: nestedParagraphs },
            (_, index) =>
                `<p>Chapter ${chapter}, paragraph ${index + 1}. This deterministic text exercises readable block extraction without using a copyrighted book.</p>`
        ).join("\n");

        zip.file(
            `EPUB/chapter-${chapter}.xhtml`,
            `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter ${chapter}</title></head>
  <body><div class="chapter"><section>${chapterAnchors}${paragraphs}</section></div></body>
</html>`
        );
    }

    return zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
    });
};
