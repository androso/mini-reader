import type { Book } from "@/types/bookTypes";
import { apiUrl } from "./api";
import { clearOfflineData, listOfflineBooks } from "./offlineStore";

export type LibraryResponse = {
    books: Book[];
    offlineFallback: boolean;
};

async function offlineLibrary(): Promise<LibraryResponse> {
    const records = await listOfflineBooks();
    return {
        books: records.map((record) => record.metadata),
        offlineFallback: true,
    };
}

export async function fetchLibrary(): Promise<LibraryResponse> {
    let response: Response;
    try {
        response = await fetch(apiUrl("/api/books"), {
            credentials: "include",
        });
    } catch {
        return offlineLibrary();
    }

    if (response.status === 401 || response.status === 403) {
        await clearOfflineData();
        throw new Error("Network response was not ok");
    }
    if (response.status >= 500) return offlineLibrary();
    if (!response.ok) throw new Error("Network response was not ok");

    const data = (await response.json()) as { books?: Book[] };
    return { books: data.books ?? [], offlineFallback: false };
}
