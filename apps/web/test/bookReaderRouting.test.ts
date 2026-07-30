import assert from "node:assert/strict";
import test from "node:test";
import {
    createOfflineReaderPath,
    createReaderPath,
    isPdfFileType,
    parseOfflineReaderHash,
} from "../src/lib/bookReaderRouting";

const epubId = "33333333-3333-4333-8333-333333333333";
const pdfId = "44444444-4444-4444-8444-444444444444";

test("createReaderPath encodes book id and file type query", () => {
    for (const [book, expected] of [
        [
            { id: epubId, fileType: "epub" as const },
            `/read/${epubId}?type=epub`,
        ],
        [{ id: pdfId, fileType: "pdf" as const }, `/read/${pdfId}?type=pdf`],
        [{ id: epubId, fileType: null }, `/read/${epubId}?type=`],
        [{ id: epubId, fileType: undefined }, `/read/${epubId}?type=`],
    ] as const) {
        assert.equal(createReaderPath(book), expected);
    }
});

test("createOfflineReaderPath defaults non-pdf types to epub", () => {
    for (const [book, expected] of [
        [
            { id: epubId, fileType: "epub" as const },
            `/offline/read#${epubId}:epub`,
        ],
        [{ id: pdfId, fileType: "pdf" as const }, `/offline/read#${pdfId}:pdf`],
        [{ id: epubId, fileType: null }, `/offline/read#${epubId}:epub`],
        [{ id: epubId, fileType: undefined }, `/offline/read#${epubId}:epub`],
    ] as const) {
        assert.equal(createOfflineReaderPath(book), expected);
    }
});

test("parseOfflineReaderHash accepts UUID hashes with or without a leading #", () => {
    for (const [hash, expected] of [
        [`#${epubId}:epub`, { bookId: epubId, fileType: "epub" as const }],
        [`${pdfId}:pdf`, { bookId: pdfId, fileType: "pdf" as const }],
        [
            `#${epubId.toUpperCase()}:epub`,
            { bookId: epubId.toUpperCase(), fileType: "epub" as const },
        ],
    ] as const) {
        assert.deepEqual(parseOfflineReaderHash(hash), expected, hash);
    }
});

test("parseOfflineReaderHash rejects malformed or unsupported hashes", () => {
    for (const hash of [
        "",
        "#",
        `#${epubId}`,
        `#${epubId}:txt`,
        `#${epubId}:EPUB`,
        "#not-a-uuid:epub",
        "#00000000-0000-0000-0000-000000000000:epub",
        `#${epubId}:epub:extra`,
        "epub",
    ] as const) {
        assert.equal(parseOfflineReaderHash(hash), null, hash);
    }
});

test("isPdfFileType is true only for the pdf literal", () => {
    for (const [value, expected] of [
        ["pdf", true],
        ["epub", false],
        ["PDF", false],
        ["", false],
        [null, false],
    ] as const) {
        assert.equal(isPdfFileType(value), expected, String(value));
    }
});
