import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { fetchCurrentUser, signOut, type AuthResponse } from "../src/lib/auth";
import { fetchLibrary } from "../src/lib/offlineLibrary";
import {
    cacheSession,
    clearOfflineData,
    getCachedSession,
    listOfflineBooks,
    storeOfflineBook,
} from "../src/lib/offlineStore";
import type { Book } from "../src/types/bookTypes";

const session: AuthResponse = {
    user: { id: "user-a", name: "A", email: "a@example.com" },
};
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

test("the current user falls back on network failure but a reachable 401 purges cached data", async () => {
    await cacheSession(session);
    await storeOfflineBook(book, new Blob(["epub"]));
    globalThis.fetch = async () => {
        throw new TypeError("offline");
    };
    assert.deepEqual(await fetchCurrentUser(), session);

    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(fetchCurrentUser(), /Network response was not ok/);
    assert.equal(await getCachedSession(), null);
    assert.deepEqual(await listOfflineBooks(), []);
});

test("sign out clears offline data even when the logout request rejects", async () => {
    await cacheSession(session);
    await storeOfflineBook(book, new Blob(["epub"]));
    globalThis.fetch = async () => {
        throw new TypeError("offline");
    };

    await assert.rejects(signOut(), /offline/);

    assert.equal(await getCachedSession(), null);
    assert.deepEqual(await listOfflineBooks(), []);
});

test("the library falls back only for unavailable servers and never for 401", async () => {
    await cacheSession(session);
    await storeOfflineBook(book, new Blob(["epub"]));
    globalThis.fetch = async () => new Response(null, { status: 503 });

    assert.deepEqual(await fetchLibrary(), {
        books: [{ ...book, createdAt: "2026-01-02T03:04:05.000Z" }],
        offlineFallback: true,
    });

    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(fetchLibrary(), /Network response was not ok/);
    assert.deepEqual(await listOfflineBooks(), []);
});
