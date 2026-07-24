import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import type { AuthResponse } from "../src/lib/auth";
import {
    cacheSession,
    clearOfflineData,
    getCachedSession,
    getOfflineBook,
    getOfflineProgress,
    listOfflineBooks,
    putOfflineProgress,
    removeOfflineBook,
    storeOfflineBook,
} from "../src/lib/offlineStore";
import type { Book } from "../src/types/bookTypes";

const userA: AuthResponse = {
    user: { id: "user-a", name: "A", email: "a@example.com" },
};
const userB: AuthResponse = {
    user: { id: "user-b", name: "B", email: "b@example.com" },
};
const epubBook: Book = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Offline EPUB",
    fileType: "epub",
    processingStatus: "ready",
    processingError: null,
    createdAt: "2026-01-02T03:04:05.000Z",
};
const pdfBook: Book = {
    ...epubBook,
    id: "22222222-2222-4222-8222-222222222222",
    title: "Offline PDF",
    fileType: "pdf",
};

async function bytes(blob: Blob): Promise<number[]> {
    return [...new Uint8Array(await blob.arrayBuffer())];
}

test.beforeEach(async () => {
    await clearOfflineData();
});

test("an account switch clears the prior account's books and progress atomically", async () => {
    await cacheSession(userA);
    await storeOfflineBook(epubBook, new Blob([new Uint8Array([1, 2, 3])]));
    await putOfflineProgress({
        bookId: epubBook.id,
        progressPosition: "12",
        progressChapter: "chapter-1",
        dirty: true,
    });

    await cacheSession(userB);

    assert.deepEqual(await getCachedSession(), userB);
    assert.deepEqual(await listOfflineBooks(), []);
    assert.equal(await getOfflineProgress(epubBook.id), undefined);
});

test("EPUB and PDF blobs preserve bytes and store only public metadata", async () => {
    const epubBytes = new Uint8Array([80, 75, 3, 4]);
    const pdfBytes = new Uint8Array([37, 80, 68, 70]);
    await storeOfflineBook(epubBook, new Blob([epubBytes]));
    await storeOfflineBook(pdfBook, new Blob([pdfBytes]));

    const records = (await listOfflineBooks()).sort((a, b) =>
        a.bookId.localeCompare(b.bookId)
    );
    assert.deepEqual(await bytes(records[0].blob), [...epubBytes]);
    assert.deepEqual(await bytes(records[1].blob), [...pdfBytes]);
    assert.equal(records[0].mimeType, "application/epub+zip");
    assert.equal(records[1].mimeType, "application/pdf");
    assert.deepEqual(Object.keys(records[0].metadata).sort(), [
        "createdAt",
        "fileType",
        "id",
        "processingError",
        "processingStatus",
        "title",
    ]);
    assert.equal(records[0].metadata.createdAt, "2026-01-02T03:04:05.000Z");

    await removeOfflineBook(epubBook.id);
    assert.equal(await getOfflineBook(epubBook.id), undefined);
    assert.ok(await getOfflineBook(pdfBook.id));
});

test("a quota failure replacing a download preserves the prior record", async () => {
    await storeOfflineBook(epubBook, new Blob([new Uint8Array([1, 2, 3])]));
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
        throw new DOMException("quota", "QuotaExceededError");
    };

    try {
        await assert.rejects(
            storeOfflineBook(epubBook, new Blob([new Uint8Array([9, 9, 9])])),
            (error: unknown) =>
                error instanceof DOMException &&
                error.name === "QuotaExceededError"
        );
    } finally {
        IDBObjectStore.prototype.put = originalPut;
    }

    const preserved = await getOfflineBook(epubBook.id);
    assert.ok(preserved);
    assert.deepEqual(await bytes(preserved.blob), [1, 2, 3]);
});
