import type { Book } from "@/types/bookTypes";

export const createReaderPath = (book: Pick<Book, "id" | "fileType">) =>
    `/read/${book.id}?type=${book.fileType ?? ""}`;

export const createOfflineReaderPath = (
    book: Pick<Book, "id" | "fileType">
): string =>
    `/offline/read#${book.id}:${book.fileType === "pdf" ? "pdf" : "epub"}`;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOfflineReaderHash(
    hash: string
): { bookId: string; fileType: "epub" | "pdf" } | null {
    const match = /^#?([^:]+):(epub|pdf)$/.exec(hash);
    if (!match || !UUID_PATTERN.test(match[1])) return null;
    return {
        bookId: match[1],
        fileType: match[2] as "epub" | "pdf",
    };
}

export const isPdfFileType = (fileType: string | null) => fileType === "pdf";
