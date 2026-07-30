import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { fetchLibrary } from "../src/lib/offlineLibrary";
import {
    clearOfflineData,
    listOfflineBooks,
    storeOfflineBook,
} from "../src/lib/offlineStore";
import type { Book } from "../src/types/bookTypes";

const book: Book = {
    id: "55555555-5555-4555-8555-555555555555",
    title: "Library EPUB",
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

test("fetchLibrary returns online books when the network succeeds", async () => {
    const onlineBook = { ...book, title: "Online" };
    globalThis.fetch = async () =>
        Response.json({ books: [onlineBook] }, { status: 200 });

    assert.deepEqual(await fetchLibrary(), {
        books: [onlineBook],
        offlineFallback: false,
    });
});

test("fetchLibrary defaults missing books arrays to empty", async () => {
    globalThis.fetch = async () => Response.json({}, { status: 200 });
    assert.deepEqual(await fetchLibrary(), {
        books: [],
        offlineFallback: false,
    });
});

test("fetchLibrary falls back offline on network failure and 5xx", async () => {
    await storeOfflineBook(book, new Blob(["epub"]));

    for (const scenario of [
        async () => {
            throw new TypeError("offline");
        },
        async () => new Response(null, { status: 502 }),
    ] as const) {
        globalThis.fetch = scenario;
        const result = await fetchLibrary();
        assert.equal(result.offlineFallback, true);
        assert.equal(result.books.length, 1);
        assert.equal(result.books[0]?.id, book.id);
    }
});

test("fetchLibrary purges offline data on 401 and 403", async () => {
    for (const status of [401, 403] as const) {
        await storeOfflineBook(book, new Blob(["epub"]));
        globalThis.fetch = async () => new Response(null, { status });
        await assert.rejects(fetchLibrary(), /Network response was not ok/);
        assert.deepEqual(await listOfflineBooks(), []);
    }
});

test("fetchLibrary rejects non-auth client errors without falling back", async () => {
    await storeOfflineBook(book, new Blob(["epub"]));
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(fetchLibrary(), /Network response was not ok/);
    assert.equal((await listOfflineBooks()).length, 1);
});
