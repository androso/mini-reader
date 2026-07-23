export type BookFileKind = "epub" | "pdf" | "unknown";

export interface BookFileKindInput {
    fileType?: "epub" | "pdf" | null;
    title?: string | null;
}

/**
 * Resolve the effective book kind for client-side cover loading.
 * Legacy rows may omit `fileType`; titles ending in `.epub` still count as EPUB.
 */
export const resolveBookFileKind = (book: BookFileKindInput): BookFileKind => {
    if (book.fileType === "epub" || book.fileType === "pdf") {
        return book.fileType;
    }

    const title = (book.title ?? "").trim().toLowerCase();
    if (title.endsWith(".epub")) return "epub";

    return "unknown";
};

export const isEpubBook = (book: BookFileKindInput): boolean =>
    resolveBookFileKind(book) === "epub";
