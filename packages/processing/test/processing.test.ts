import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import type { StorageProvider, VectorStoreProvider } from "@reader/providers";
import JSZip from "jszip";
import {
    createBookCollectionName,
    createEpubCollectionName,
    createPdfCollectionName,
    decodePdfTextRuns,
    extractBookMetadata,
    extractEpubBook,
    extractEpubMetadata,
    extractPdfBook,
    extractPdfMetadata,
    normalizeBookMetadataValue,
    processBookForSearch,
    TextChunker,
} from "../src";

const createMetadataEpub = async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
        "META-INF/container.xml",
        '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    );
    zip.file(
        "EPUB/content.opf",
        '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>  The Left Hand   of Darkness  </dc:title><dc:creator> Ursula K. Le Guin </dc:creator><dc:identifier> urn:isbn:test </dc:identifier></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'
    );
    zip.file(
        "EPUB/chapter.xhtml",
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Winter is an inimical world.</p></body></html>'
    );
    return zip.generateAsync({ type: "nodebuffer" });
};

const createMockStorage = (file = Buffer.from("book")): StorageProvider => ({
    uploadFile: async () => undefined,
    getFile: async () => file,
    deleteFile: async () => undefined,
});

const createMockVectorStore = () => {
    const calls = {
        resetCollection: [] as string[],
        addDocuments: [] as Array<{
            collectionName: string;
            documents: string[];
        }>,
    };
    const provider: VectorStoreProvider = {
        createCollection: async () => ({}),
        getOrCreateCollection: async () => ({}),
        getCollection: async () => null,
        queryCollection: async () => ({}),
        searchDocuments: async () => [],
        deleteCollection: async () => true,
        resetCollection: async (name) => {
            calls.resetCollection.push(name);
        },
        addDocuments: async (collectionName, documents) => {
            calls.addDocuments.push({ collectionName, documents });
        },
    };

    return { provider, calls };
};

const createMockSearchIndexStore = () => {
    const calls = {
        replaceCollectionChunks: [] as Array<{
            collectionName: string;
            chunks: string[];
        }>,
    };

    return {
        provider: {
            replaceCollectionChunks: async (
                collectionName: string,
                chunks: string[]
            ) => {
                calls.replaceCollectionChunks.push({
                    collectionName,
                    chunks,
                });
            },
        },
        calls,
    };
};

test("processes EPUB with mocked storage and vector store", async () => {
    const vector = createMockVectorStore();
    const searchIndex = createMockSearchIndexStore();

    const result = await processBookForSearch(
        {
            bookId: "11111111-1111-1111-1111-111111111111",
            fileKey: "epub-key",
            fileType: "epub",
        },
        {
            storage: createMockStorage(),
            vectorStore: vector.provider,
            searchIndexStore: searchIndex.provider,
            extractEpubBook: async () => ({
                chunks: ["one", "two"],
                metadata: {
                    title: "Embedded title",
                    creator: null,
                    identifier: null,
                },
            }),
        }
    );

    const collectionName = "book_11111111_1111_1111_1111_111111111111";
    assert.deepEqual(result, {
        collectionName,
        chunks: 2,
        reusedCollection: false,
        metadata: {
            title: "Embedded title",
            creator: null,
            identifier: null,
        },
    });
    assert.deepEqual(vector.calls.resetCollection, [collectionName]);
    assert.deepEqual(vector.calls.addDocuments, [
        { collectionName, documents: ["one", "two"] },
    ]);
    assert.deepEqual(searchIndex.calls.replaceCollectionChunks, [
        { collectionName, chunks: [] },
        { collectionName, chunks: ["one", "two"] },
    ]);
});

test("processes PDF with mocked storage and vector store", async () => {
    const vector = createMockVectorStore();

    const result = await processBookForSearch(
        {
            bookId: "22222222-2222-2222-2222-222222222222",
            fileKey: "pdf-key",
            fileType: "pdf",
        },
        {
            storage: createMockStorage(),
            vectorStore: vector.provider,
            extractPdfBook: async () => ({
                chunks: ["pdf text"],
                metadata: {
                    title: null,
                    creator: "PDF Author",
                    identifier: null,
                },
            }),
        }
    );

    assert.equal(
        result.collectionName,
        "book_22222222_2222_2222_2222_222222222222"
    );
    assert.equal(result.chunks, 1);
    assert.deepEqual(vector.calls.resetCollection, [result.collectionName]);
});

test("identical content in different books uses isolated collections", async () => {
    const vector = createMockVectorStore();
    const first = await processBookForSearch(
        {
            bookId: "33333333-3333-3333-3333-333333333333",
            fileKey: "same-key",
            fileType: "epub",
        },
        {
            storage: createMockStorage(Buffer.from("identical")),
            vectorStore: vector.provider,
            extractEpubBook: async () => ({
                chunks: ["same text"],
                metadata: { title: null, creator: null, identifier: null },
            }),
        }
    );
    const second = await processBookForSearch(
        {
            bookId: "44444444-4444-4444-4444-444444444444",
            fileKey: "same-key",
            fileType: "epub",
        },
        {
            storage: createMockStorage(Buffer.from("identical")),
            vectorStore: vector.provider,
            extractEpubBook: async () => ({
                chunks: ["same text"],
                metadata: { title: null, creator: null, identifier: null },
            }),
        }
    );

    assert.notEqual(first.collectionName, second.collectionName);
    assert.deepEqual(vector.calls.resetCollection, [
        first.collectionName,
        second.collectionName,
    ]);
});

test("fails when processing extracts no chunks", async () => {
    const vector = createMockVectorStore();

    await assert.rejects(
        processBookForSearch(
            {
                bookId: "55555555-5555-5555-5555-555555555555",
                fileKey: "epub-key",
                fileType: "epub",
            },
            {
                storage: createMockStorage(),
                vectorStore: vector.provider,
                extractEpubBook: async () => ({
                    chunks: [],
                    metadata: {
                        title: null,
                        creator: null,
                        identifier: null,
                    },
                }),
            }
        ),
        /No valid text chunks extracted/
    );
});

test("collection identity depends only on book id", () => {
    assert.equal(
        createBookCollectionName("66666666-6666-6666-6666-666666666666"),
        "book_66666666_6666_6666_6666_666666666666"
    );
});

test("text chunker returns bounded chunks", () => {
    const chunker = new TextChunker({
        minChunkSize: 1,
        targetChunkSize: 20,
        maxChunkSize: 30,
    });

    const chunks = chunker.chunkText(
        "First sentence is here. Second sentence is here. Third sentence is here."
    );

    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= 30));
});

test("text chunker removes only empty input and preserves one short document", () => {
    const chunker = new TextChunker({
        minChunkSize: 10,
        targetChunkSize: 20,
        maxChunkSize: 40,
    });

    assert.deepEqual(chunker.chunkText(" \n\t "), []);
    assert.deepEqual(chunker.chunkText("Tiny."), ["Tiny."]);
});

test("text chunker preserves exact maximum and minimum boundaries", () => {
    const chunker = new TextChunker({
        minChunkSize: 5,
        targetChunkSize: 20,
        maxChunkSize: 30,
    });
    const exactMaximum = "M".repeat(30);
    const exactMinimumTail = "Tiny.";
    const leadingSentence = `${"L".repeat(25)}.`;

    assert.deepEqual(chunker.chunkText(exactMaximum), [exactMaximum]);
    assert.deepEqual(
        chunker.chunkText(`${leadingSentence} ${exactMinimumTail}`),
        [leadingSentence, ` ${exactMinimumTail}`]
    );
});

test("text chunker merges a short tail when the result remains bounded", () => {
    const chunker = new TextChunker({
        minChunkSize: 10,
        targetChunkSize: 20,
        maxChunkSize: 40,
    });
    const first = `${"A".repeat(24)}.`;
    const previous = `${"B".repeat(24)}.`;
    const tail = "Tiny.";

    assert.deepEqual(chunker.chunkText(`${first} ${previous} ${tail}`), [
        first,
        ` ${previous} ${tail}`,
    ]);
});

test("text chunker allows a short-tail merge exactly at the maximum", () => {
    const chunker = new TextChunker({
        minChunkSize: 10,
        targetChunkSize: 20,
        maxChunkSize: 40,
    });
    const first = `${"A".repeat(24)}.`;
    const previous = `${"B".repeat(30)}.`;
    const tail = "Little.";

    const chunks = chunker.chunkText(`${first} ${previous} ${tail}`);

    assert.deepEqual(chunks, [first, ` ${previous} ${tail}`]);
    assert.equal(chunks[1].length, 40);
});

test("text chunker rebalances a short tail without exceeding the maximum", () => {
    const chunker = new TextChunker({
        minChunkSize: 10,
        targetChunkSize: 20,
        maxChunkSize: 40,
    });
    const input = "This is a sufficiently long sentence. Tiny.";

    const chunks = chunker.chunkText(input);

    assert.equal(chunks.length, 2);
    assert.equal(
        chunks.every((chunk) => chunk.length <= 40),
        true
    );
    assert.equal(chunks.every(Boolean), true);
    assert.equal(chunks.join(""), input);
    assert.deepEqual(chunks, chunker.chunkText(input));
});

test("text chunker preserves an unterminated trailing fragment", () => {
    const chunker = new TextChunker({
        minChunkSize: 15,
        targetChunkSize: 20,
        maxChunkSize: 40,
    });
    const input = "This sentence is long enough to split. final fragment";

    const chunks = chunker.chunkText(input);

    assert.equal(chunks.join(""), input);
    assert.equal(chunks.at(-1)?.includes("final fragment"), true);
    assert.equal(
        chunks.every((chunk) => chunk.length <= 40),
        true
    );
});

test("pathological minimum above maximum keeps existing bounded chunks", () => {
    const chunker = new TextChunker({
        minChunkSize: 30,
        targetChunkSize: 10,
        maxChunkSize: 20,
    });
    const input = "X".repeat(45);

    const chunks = chunker.chunkText(input);

    assert.deepEqual(
        chunks.map((chunk) => chunk.length),
        [20, 20, 5]
    );
    assert.equal(chunks.join(""), input);
});

test("text chunker never invents whitespace between contiguous oversized slices", () => {
    const input = "A".repeat(3850);
    const chunks = new TextChunker().chunkText(input);

    assert.equal(chunks.join(""), input);
    assert.equal(
        chunks.reduce((length, chunk) => length + chunk.length, 0),
        input.length
    );
    assert.equal(
        chunks.some((chunk) => /\s/.test(chunk)),
        false
    );
    assert.equal(
        chunks.every((chunk) => chunk.length <= 3800),
        true
    );
});

test("text chunker reconstructs mixed semantic and hard-split boundaries", () => {
    const chunker = new TextChunker({
        minChunkSize: 1,
        targetChunkSize: 10,
        maxChunkSize: 10,
    });
    const input = `123456789 ${"A".repeat(12)}`;
    const chunks = chunker.chunkText(input);

    assert.equal(chunks.join(""), input);
    assert.equal(
        chunks.every((chunk) => chunk.length > 0),
        true
    );
    assert.equal(
        chunks.every((chunk) => chunk.length <= 10),
        true
    );
});

test("text chunker reconstructs normalized whitespace across boundaries", () => {
    const chunker = new TextChunker({
        minChunkSize: 2,
        targetChunkSize: 8,
        maxChunkSize: 10,
    });
    const input = "First\t\n  sentence.   Second\nline without punctuation";
    const normalized = input.replace(/\s+/g, " ").trim();
    const chunks = chunker.chunkText(input);

    assert.equal(chunks.join(""), normalized);
    assert.equal(
        chunks.every((chunk) => chunk.length > 0),
        true
    );
    assert.equal(
        chunks.every((chunk) => chunk.length <= 10),
        true
    );
});

test("text chunker rejects unsafe size options but permits minimum above maximum", () => {
    for (const option of [
        "minChunkSize",
        "targetChunkSize",
        "maxChunkSize",
    ] as const) {
        for (const value of [
            0,
            -1,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            1.5,
        ]) {
            assert.throws(
                () => new TextChunker({ [option]: value }),
                new RegExp(`${option} must be a positive safe integer`)
            );
        }
    }

    assert.doesNotThrow(
        () =>
            new TextChunker({
                minChunkSize: 30,
                targetChunkSize: 10,
                maxChunkSize: 20,
            })
    );
});

test("normalizes untrusted embedded metadata values", () => {
    assert.equal(
        normalizeBookMetadataValue(`  A\u0000  B\n${"x".repeat(600)}  `),
        `A B ${"x".repeat(496)}`
    );
    assert.equal(normalizeBookMetadataValue(" \u0007 \n "), null);
    assert.equal(normalizeBookMetadataValue({ title: "unsafe" }), null);
});

test("extracts normalized EPUB metadata with chapter chunks", async () => {
    const content = await extractEpubBook(await createMetadataEpub());
    assert.deepEqual(content.metadata, {
        title: "The Left Hand of Darkness",
        creator: "Ursula K. Le Guin",
        identifier: "urn:isbn:test",
    });
    assert.ok(
        content.chunks.some((chunk) =>
            chunk.includes("Winter is an inimical world.")
        )
    );
});

test("maps PDF title and author from one parsed document", async () => {
    let parses = 0;
    const parse = async () => {
        parses++;
        return {
            Transcoder: "test",
            Meta: {
                Title: "  The Left Hand of Darkness ",
                Author: " Ursula K. Le Guin ",
            },
            Pages: [
                {
                    Texts: [
                        {
                            R: [{ T: "Winter%20is%20an%20inimical%20world." }],
                        },
                    ],
                },
            ],
        };
    };
    const content = await extractPdfBook(
        Buffer.from("pdf"),
        undefined,
        parse as unknown as Parameters<typeof extractPdfBook>[2]
    );
    assert.equal(parses, 1);
    assert.deepEqual(content.metadata, {
        title: "The Left Hand of Darkness",
        creator: "Ursula K. Le Guin",
        identifier: null,
    });
    assert.deepEqual(content.chunks, ["Winter is an inimical world."]);
});

test("PDF text extraction decodes every run in source order", () => {
    assert.equal(
        decodePdfTextRuns([
            { T: "Preserve%20" },
            { T: "every%20" },
            { T: "run." },
        ]),
        "Preserve every run."
    );
});
test("extracts EPUB chunks within constrained heap limit", (t) => {
    const childScript = path.resolve(__dirname, "epub-memory-child.js");
    const result = spawnSync(
        process.execPath,
        ["--max-old-space-size=128", childScript],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                NODE_PATH: process.env.NODE_PATH,
            },
        }
    );

    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "EPERM") {
        t.skip("The local sandbox does not permit nested process creation");
        return;
    }

    assert.ifError(result.error);
    assert.equal(
        result.status,
        0,
        `Child process failed with stderr: ${result.stderr}`
    );
    assert.match(result.stdout, /EPUB_EXTRACTION_OK:\d+/);
});

test("createEpubCollectionName and extractEpubMetadata hash normalized metadata", async () => {
    const buffer = await createMetadataEpub();
    const collectionName = await createEpubCollectionName(buffer);
    assert.match(collectionName, /^book_[a-f0-9]{12}$/);

    const metadata = await extractEpubMetadata(buffer);
    assert.deepEqual(metadata, {
        title: "The Left Hand of Darkness",
        creator: "Ursula K. Le Guin",
        identifier: "urn:isbn:test",
    });

    const viaDispatcher = await extractBookMetadata(buffer, "epub");
    assert.deepEqual(viaDispatcher, metadata);
});

test("PDF ingestion covers default parser, metadata, and collection naming", async () => {
    const samplePdf = fs.readFileSync(
        path.resolve(process.cwd(), "test/fixtures/sample.pdf")
    );

    const metadata = await extractPdfMetadata(samplePdf);
    assert.equal(metadata.title, "Left Hand");
    assert.equal(metadata.creator, "Le Guin");
    assert.equal(metadata.identifier, null);

    const viaDispatcher = await extractBookMetadata(samplePdf, "pdf");
    assert.deepEqual(viaDispatcher, metadata);

    const collectionName = await createPdfCollectionName(samplePdf);
    assert.match(collectionName, /^pdf_[a-f0-9]{12}$/);

    const content = await extractPdfBook(samplePdf);
    assert.ok(Array.isArray(content.chunks));
    assert.equal(content.metadata.title, "Left Hand");

    await assert.rejects(createPdfCollectionName(Buffer.from("not-a-pdf")));
    await assert.rejects(extractPdfMetadata(Buffer.from("%PDF-broken")));
});

test("text chunker covers match fallback and failed rebalance guards", () => {
    const originalMatch = String.prototype.match;
    const chunker = new TextChunker({
        minChunkSize: 10,
        targetChunkSize: 12,
        maxChunkSize: 20,
    });

    try {
        // Force the regex match fallback branch for oversized input.
        String.prototype.match = function matchOverride(this: string) {
            if (this.length > 20) return null;
            return originalMatch.call(this, arguments[0] as RegExp);
        } as typeof String.prototype.match;
        const chunks = chunker.chunkText("A".repeat(45));
        assert.ok(chunks.length >= 2);
        assert.equal(chunks.join(""), "A".repeat(45));
    } finally {
        String.prototype.match = originalMatch;
    }

    const tight = new TextChunker({
        minChunkSize: 8,
        targetChunkSize: 10,
        maxChunkSize: 12,
    });
    const input = `${"W".repeat(11)}. ${"Z".repeat(11)}.`;
    const rebalanced = tight.chunkText(input);
    assert.ok(rebalanced.every((chunk) => chunk.length <= 12));
    assert.equal(rebalanced.join(""), input.replace(/\s+/g, " ").trim());
});
