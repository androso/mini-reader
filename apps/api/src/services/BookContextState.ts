export const BOOK_CONTEXT_STATUSES = [
    "ready",
    "processing",
    "not_found",
    "ingestion_failed",
    "retrieval_unavailable",
    "no_relevant_context",
] as const;

export type BookContextStatus = (typeof BOOK_CONTEXT_STATUSES)[number];

export type StoredBookContextState = {
    processingStatus: string;
    collectionName: string | null;
};

export const classifyStoredBookContext = (
    book: StoredBookContextState | null | undefined
): Exclude<BookContextStatus, "no_relevant_context"> => {
    if (!book || book.processingStatus === "deleting") return "not_found";

    if (
        book.processingStatus === "failed" ||
        book.processingStatus === "queue_failed"
    ) {
        return "ingestion_failed";
    }

    if (book.processingStatus === "processing") return "processing";

    if (book.processingStatus !== "ready" || !book.collectionName) {
        return "retrieval_unavailable";
    }

    return "ready";
};

export const BOOK_CONTEXT_FAILURE_MESSAGES: Record<
    Exclude<BookContextStatus, "ready" | "no_relevant_context">,
    string
> = {
    processing:
        "Document context is still processing. Please try again shortly.",
    not_found: "This book is no longer available.",
    ingestion_failed: "Document text processing failed.",
    retrieval_unavailable:
        "Book context is temporarily unavailable. Please try again later.",
};
