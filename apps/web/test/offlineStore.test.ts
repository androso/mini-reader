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
    getStorageEstimate,
    listOfflineBooks,
    listOfflineProgress,
    markProgressSynced,
    putOfflineProgress,
    removeOfflineBook,
    removeOfflineProgress,
    requestPersistentStorage,
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

test("unsupported file types are rejected before IndexedDB writes", async () => {
    await assert.rejects(
        storeOfflineBook(
            { ...epubBook, fileType: null },
            new Blob([new Uint8Array([1])])
        ),
        /Only EPUB and PDF books can be stored offline\./
    );
    assert.deepEqual(await listOfflineBooks(), []);
});

test("IndexedDB read and delete failures propagate to callers", async () => {
    await storeOfflineBook(epubBook, new Blob([new Uint8Array([1, 2, 3])]));
    await putOfflineProgress({
        bookId: epubBook.id,
        progressPosition: "1",
        progressChapter: "c1",
        dirty: true,
    });

    const originalGet = IDBObjectStore.prototype.get;
    const originalDelete = IDBObjectStore.prototype.delete;

    IDBObjectStore.prototype.get = function () {
        throw new DOMException("get failed", "UnknownError");
    };
    try {
        await assert.rejects(
            getOfflineBook(epubBook.id),
            (error: unknown) =>
                error instanceof DOMException && error.name === "UnknownError"
        );
    } finally {
        IDBObjectStore.prototype.get = originalGet;
    }

    IDBObjectStore.prototype.delete = function () {
        throw new DOMException("delete failed", "UnknownError");
    };
    try {
        await assert.rejects(
            removeOfflineBook(epubBook.id),
            (error: unknown) =>
                error instanceof DOMException && error.name === "UnknownError"
        );
        await assert.rejects(
            removeOfflineProgress(epubBook.id),
            (error: unknown) =>
                error instanceof DOMException && error.name === "UnknownError"
        );
    } finally {
        IDBObjectStore.prototype.delete = originalDelete;
    }

    assert.ok(await getOfflineBook(epubBook.id));
    assert.ok(await getOfflineProgress(epubBook.id));
});

test("markProgressSynced clears dirty only for the matching revision", async () => {
    const first = await putOfflineProgress({
        bookId: epubBook.id,
        progressPosition: "1",
        progressChapter: "c1",
        dirty: true,
    });
    await markProgressSynced(epubBook.id, first.revision - 1);
    assert.equal((await getOfflineProgress(epubBook.id))?.dirty, true);

    await markProgressSynced(epubBook.id, first.revision);
    assert.equal((await getOfflineProgress(epubBook.id))?.dirty, false);

    const second = await putOfflineProgress({
        bookId: epubBook.id,
        progressPosition: "2",
        progressChapter: "c2",
        dirty: true,
    });
    assert.equal(second.revision, first.revision + 1);
    assert.deepEqual(
        (await listOfflineProgress()).map((record) => record.bookId),
        [epubBook.id]
    );

    await removeOfflineProgress(epubBook.id);
    assert.equal(await getOfflineProgress(epubBook.id), undefined);
});

test("storage helpers fall back when navigator.storage is unavailable", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(
        globalThis.navigator,
        "storage"
    );

    Object.defineProperty(globalThis.navigator, "storage", {
        configurable: true,
        value: undefined,
    });
    try {
        assert.equal(await requestPersistentStorage(), false);
        assert.deepEqual(await getStorageEstimate(), {});
    } finally {
        if (originalStorage) {
            Object.defineProperty(
                globalThis.navigator,
                "storage",
                originalStorage
            );
        } else {
            Reflect.deleteProperty(globalThis.navigator, "storage");
        }
    }

    Object.defineProperty(globalThis.navigator, "storage", {
        configurable: true,
        value: {
            persist: async () => true,
            estimate: async () => ({ quota: 10, usage: 2 }),
        },
    });
    try {
        assert.equal(await requestPersistentStorage(), true);
        assert.deepEqual(await getStorageEstimate(), { quota: 10, usage: 2 });
    } finally {
        if (originalStorage) {
            Object.defineProperty(
                globalThis.navigator,
                "storage",
                originalStorage
            );
        } else {
            Reflect.deleteProperty(globalThis.navigator, "storage");
        }
    }
});
