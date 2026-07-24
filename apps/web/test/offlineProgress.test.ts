import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as waitImmediate } from "node:timers/promises";
import "fake-indexeddb/auto";
import {
    flushPendingProgress,
    saveReadingProgress,
} from "../src/lib/offlineProgress";
import {
    clearOfflineData,
    getOfflineProgress,
    putOfflineProgress,
    storeOfflineBook,
} from "../src/lib/offlineStore";
import type { Book } from "../src/types/bookTypes";

const book: Book = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Offline EPUB",
    fileType: "epub",
    processingStatus: "ready",
    processingError: null,
    createdAt: "2026-01-02T03:04:05.000Z",
};
const secondBookId = "22222222-2222-4222-8222-222222222222";
const originalFetch = globalThis.fetch;

function deferred<T>() {
    return Promise.withResolvers<T>();
}

async function waitFor(predicate: () => boolean): Promise<void> {
    while (!predicate()) await waitImmediate();
}

test.beforeEach(async () => {
    globalThis.fetch = originalFetch;
    await clearOfflineData();
});

test.after(() => {
    globalThis.fetch = originalFetch;
});

test("repeated saves coalesce and an older completion cannot acknowledge a newer revision", async () => {
    await storeOfflineBook(book, new Blob(["epub"]));
    const requests = [deferred<Response>(), deferred<Response>()];
    let requestCount = 0;
    globalThis.fetch = async () => requests[requestCount++].promise;

    const firstSave = saveReadingProgress(book.id, "block-1", "chapter-1");
    await waitFor(() => requestCount === 1);
    const secondSave = saveReadingProgress(book.id, "block-2", "chapter-2");
    await waitFor(() => requestCount === 2);

    requests[0].resolve(new Response(null, { status: 204 }));
    await firstSave;
    assert.deepEqual(await getOfflineProgress(book.id), {
        bookId: book.id,
        progressPosition: "block-2",
        progressChapter: "chapter-2",
        revision: 2,
        dirty: true,
        updatedAt: (await getOfflineProgress(book.id))?.updatedAt,
    });

    requests[1].resolve(new Response(null, { status: 204 }));
    await secondSave;
    assert.equal((await getOfflineProgress(book.id))?.dirty, false);
});

test("flush removes 404 orphans but stops and retains dirty work on 401 and 5xx", async () => {
    await putOfflineProgress({
        bookId: book.id,
        progressPosition: "block-1",
        progressChapter: "chapter-1",
        dirty: true,
    });
    await putOfflineProgress({
        bookId: secondBookId,
        progressPosition: "block-2",
        progressChapter: "chapter-2",
        dirty: true,
    });

    let responseStatus = 404;
    globalThis.fetch = async () =>
        new Response(null, { status: responseStatus });
    await flushPendingProgress();
    assert.equal(await getOfflineProgress(book.id), undefined);
    assert.equal(await getOfflineProgress(secondBookId), undefined);

    await putOfflineProgress({
        bookId: book.id,
        progressPosition: "block-3",
        progressChapter: "chapter-3",
        dirty: true,
    });
    responseStatus = 401;
    await flushPendingProgress();
    assert.equal((await getOfflineProgress(book.id))?.dirty, true);

    responseStatus = 503;
    await flushPendingProgress();
    assert.equal((await getOfflineProgress(book.id))?.dirty, true);
});
