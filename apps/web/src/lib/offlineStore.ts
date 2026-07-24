import type {
    DBSchema,
    IDBPDatabase,
} from "idb" with { "resolution-mode": "import" };
import type { Book } from "@/types/bookTypes";
import type { AuthResponse } from "./auth";

export type CachedSession = {
    key: "current";
    userId: string;
    response: AuthResponse;
    cachedAt: string;
};

export type OfflineBookRecord = {
    bookId: string;
    metadata: Omit<Book, "createdAt"> & { createdAt: string };
    blob: Blob;
    mimeType: "application/epub+zip" | "application/pdf";
    byteLength: number;
    downloadedAt: string;
};

export type OfflineProgressRecord = {
    bookId: string;
    progressPosition: string;
    progressChapter: string;
    revision: number;
    dirty: boolean;
    updatedAt: string;
};

export type ReadingProgressInput = {
    bookId: string;
    progressPosition: string;
    progressChapter: string;
    dirty: boolean;
};

interface OfflineDatabase extends DBSchema {
    session: {
        key: "current";
        value: CachedSession;
    };
    books: {
        key: string;
        value: OfflineBookRecord;
    };
    progress: {
        key: string;
        value: OfflineProgressRecord;
    };
}

let databasePromise: Promise<IDBPDatabase<OfflineDatabase>> | undefined;
function getDatabase(): Promise<IDBPDatabase<OfflineDatabase>> {
    databasePromise ??= import("idb").then(({ openDB }) =>
        openDB<OfflineDatabase>("mentarie-offline", 1, {
            upgrade(database) {
                database.createObjectStore("session");
                database.createObjectStore("books", { keyPath: "bookId" });
                database.createObjectStore("progress", { keyPath: "bookId" });
            },
        })
    );
    return databasePromise;
}

export async function cacheSession(response: AuthResponse): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(
        ["session", "books", "progress"],
        "readwrite"
    );
    const current = await transaction.objectStore("session").get("current");

    if (current && current.userId !== response.user.id) {
        await Promise.all([
            transaction.objectStore("books").clear(),
            transaction.objectStore("progress").clear(),
        ]);
    }

    await transaction.objectStore("session").put(
        {
            key: "current",
            userId: response.user.id,
            response,
            cachedAt: new Date().toISOString(),
        },
        "current"
    );
    await transaction.done;
}

export async function getCachedSession(): Promise<AuthResponse | null> {
    const database = await getDatabase();
    return (await database.get("session", "current"))?.response ?? null;
}

export async function clearOfflineData(): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(
        ["session", "books", "progress"],
        "readwrite"
    );
    await Promise.all([
        transaction.objectStore("session").clear(),
        transaction.objectStore("books").clear(),
        transaction.objectStore("progress").clear(),
    ]);
    await transaction.done;
}

export async function listOfflineBooks(): Promise<OfflineBookRecord[]> {
    return (await getDatabase()).getAll("books");
}

export async function getOfflineBook(
    bookId: string
): Promise<OfflineBookRecord | undefined> {
    return (await getDatabase()).get("books", bookId);
}

function mimeTypeForBook(
    book: Pick<Book, "fileType">
): OfflineBookRecord["mimeType"] {
    if (book.fileType === "epub") return "application/epub+zip";
    if (book.fileType === "pdf") return "application/pdf";
    throw new Error("Only EPUB and PDF books can be stored offline.");
}

export async function storeOfflineBook(
    book: Book,
    blob: Blob
): Promise<OfflineBookRecord> {
    const mimeType = mimeTypeForBook(book);
    const record: OfflineBookRecord = {
        bookId: book.id,
        metadata: {
            id: book.id,
            title: book.title,
            fileType: book.fileType,
            processingStatus: book.processingStatus,
            processingError: book.processingError,
            createdAt: new Date(book.createdAt).toISOString(),
        },
        blob:
            blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType),
        mimeType,
        byteLength: blob.size,
        downloadedAt: new Date().toISOString(),
    };

    await (await getDatabase()).put("books", record);
    return record;
}

export async function removeOfflineBook(bookId: string): Promise<void> {
    await (await getDatabase()).delete("books", bookId);
}

export async function getOfflineProgress(
    bookId: string
): Promise<OfflineProgressRecord | undefined> {
    return (await getDatabase()).get("progress", bookId);
}

export async function putOfflineProgress(
    input: ReadingProgressInput
): Promise<OfflineProgressRecord> {
    const database = await getDatabase();
    const transaction = database.transaction("progress", "readwrite");
    const store = transaction.objectStore("progress");
    const current = await store.get(input.bookId);
    const record: OfflineProgressRecord = {
        ...input,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
    };
    await store.put(record);
    await transaction.done;
    return record;
}

export async function listOfflineProgress(): Promise<OfflineProgressRecord[]> {
    return (await getDatabase()).getAll("progress");
}

export async function removeOfflineProgress(bookId: string): Promise<void> {
    await (await getDatabase()).delete("progress", bookId);
}

export async function markProgressSynced(
    bookId: string,
    revision: number
): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction("progress", "readwrite");
    const store = transaction.objectStore("progress");
    const current = await store.get(bookId);
    if (current?.revision === revision) {
        await store.put({ ...current, dirty: false });
    }
    await transaction.done;
}

export async function requestPersistentStorage(): Promise<boolean> {
    return (await navigator.storage?.persist?.()) ?? false;
}

export async function getStorageEstimate(): Promise<StorageEstimate> {
    return (await navigator.storage?.estimate?.()) ?? {};
}
