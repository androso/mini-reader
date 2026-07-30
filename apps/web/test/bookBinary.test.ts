import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { loadBookBlob } from "../src/lib/bookBinary";
import { clearOfflineData, storeOfflineBook } from "../src/lib/offlineStore";
import type { Book } from "../src/types/bookTypes";

const book: Book = {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Network EPUB",
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

test("loadBookBlob fetches network bytes when the book is not offline", async () => {
    const networkBytes = new Uint8Array([80, 75, 3, 4, 9]);
    let sawCredentials = false;
    globalThis.fetch = async (input, init) => {
        assert.equal(String(input), `/api/books/${book.id}`);
        sawCredentials = init?.credentials === "include";
        return new Response(networkBytes, { status: 200 });
    };

    const result = await loadBookBlob({
        bookId: book.id,
        url: `/api/books/${book.id}`,
        requireLocal: false,
    });

    assert.equal(result.source, "network");
    assert.equal(sawCredentials, true);
    assert.deepEqual(
        [...new Uint8Array(await result.blob.arrayBuffer())],
        [...networkBytes]
    );
});

test("loadBookBlob rejects non-OK network responses", async () => {
    for (const status of [401, 404, 500] as const) {
        globalThis.fetch = async () => new Response(null, { status });
        await assert.rejects(
            loadBookBlob({
                bookId: book.id,
                url: `/api/books/${book.id}`,
                requireLocal: false,
            }),
            new RegExp(`Failed to fetch book: ${status}`)
        );
    }
});

test("loadBookBlob honors an aborted signal after an offline hit", async () => {
    await storeOfflineBook(book, new Blob([new Uint8Array([1, 2, 3])]));
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
        loadBookBlob({
            bookId: book.id,
            url: `/api/books/${book.id}`,
            requireLocal: false,
            signal: controller.signal,
        }),
        (error: unknown) =>
            error instanceof DOMException && error.name === "AbortError"
    );
});
