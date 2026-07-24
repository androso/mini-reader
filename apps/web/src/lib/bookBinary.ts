import { getOfflineBook } from "./offlineStore";

export type BookBlobResult = {
    blob: Blob;
    source: "offline" | "network";
};

export async function loadBookBlob(input: {
    bookId: string;
    url: string;
    requireLocal: boolean;
    signal?: AbortSignal;
}): Promise<BookBlobResult> {
    const offlineBook = await getOfflineBook(input.bookId);
    if (offlineBook) {
        if (input.signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }
        return { blob: offlineBook.blob, source: "offline" };
    }

    if (input.requireLocal) {
        throw new Error("This book isn't downloaded on this device.");
    }

    const response = await fetch(input.url, {
        credentials: "include",
        signal: input.signal,
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch book: ${response.status}`);
    }
    return { blob: await response.blob(), source: "network" };
}
