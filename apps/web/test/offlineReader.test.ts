import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { loadBookBlob } from "../src/lib/bookBinary";
import {
    createOfflineReaderPath,
    parseOfflineReaderHash,
} from "../src/lib/bookReaderRouting";
import { clearOfflineData, storeOfflineBook } from "../src/lib/offlineStore";
import type { Book } from "../src/types/bookTypes";

const book: Book = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Offline EPUB",
    fileType: "epub",
    processingStatus: "ready",
    processingError: null,
    createdAt: "2026-01-02T03:04:05.000Z",
};
const originalFetch = globalThis.fetch;

test.beforeEach(async () => {
    globalThis.fetch = originalFetch;
    await clearOfflineData();
});

test.after(() => {
    globalThis.fetch = originalFetch;
});

test("loadBookBlob prefers exact local bytes without making a network request", async () => {
    const localBytes = new Uint8Array([80, 75, 3, 4]);
    await storeOfflineBook(book, new Blob([localBytes]));
    let fetches = 0;
    globalThis.fetch = async () => {
        fetches += 1;
        return new Response("network");
    };

    const result = await loadBookBlob({
        bookId: book.id,
        url: `/api/books/${book.id}`,
        requireLocal: false,
    });

    assert.equal(result.source, "offline");
    assert.deepEqual(
        [...new Uint8Array(await result.blob.arrayBuffer())],
        [...localBytes]
    );
    assert.equal(fetches, 0);
});

test("a required local book never falls back to the network", async () => {
    let fetches = 0;
    globalThis.fetch = async () => {
        fetches += 1;
        return new Response("network");
    };

    await assert.rejects(
        loadBookBlob({
            bookId: book.id,
            url: `/api/books/${book.id}`,
            requireLocal: true,
        }),
        /This book isn't downloaded on this device\./
    );
    assert.equal(fetches, 0);
});

test("offline reader hashes accept only UUID book IDs and supported file types", () => {
    const path = createOfflineReaderPath(book);
    assert.equal(path, `/offline/read#${book.id}:epub`);
    assert.deepEqual(parseOfflineReaderHash(`#${book.id}:pdf`), {
        bookId: book.id,
        fileType: "pdf",
    });
    assert.equal(parseOfflineReaderHash("#not-a-uuid:epub"), null);
    assert.equal(parseOfflineReaderHash(`#${book.id}:txt`), null);
    assert.equal(parseOfflineReaderHash(`#${book.id}`), null);
});
