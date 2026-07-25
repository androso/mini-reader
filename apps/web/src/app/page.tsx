"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";
import toast from "react-hot-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AuthProtection } from "@/components/AuthProtection";
import BookCover from "@/components/BookCover";
import { ReadingThemeToggle } from "@/components/ReadingThemeToggle";
import { useReadingTheme } from "@/hooks/useReadingTheme";
import type { Book } from "@/types/bookTypes";
import { apiUrl } from "@/lib/api";
import {
    createOfflineReaderPath,
    createReaderPath,
} from "@/lib/bookReaderRouting";
import { fetchLibrary } from "@/lib/offlineLibrary";
import {
    getOfflineProgress,
    listOfflineBooks,
    removeOfflineBook,
    removeOfflineProgress,
    requestPersistentStorage,
    storeOfflineBook,
} from "@/lib/offlineStore";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
    BookOpenText,
    Check,
    Clock3,
    Download,
    FileText,
    LibraryBig,
    LogOut,
    Settings,
    Trash2,
    Upload,
    X,
} from "lucide-react";

type LibraryFilter = "all" | "epub" | "pdf";

const LIBRARY_FILTERS = [
    { value: "all", label: "All" },
    { value: "epub", label: "EPUB" },
    { value: "pdf", label: "PDF" },
] as const satisfies ReadonlyArray<{ value: LibraryFilter; label: string }>;

function formatRelativeDate(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor(
        (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 0) return "Added today";
    if (diffDays === 1) return "Added yesterday";
    if (diffDays < 7) return `Added ${diffDays} days ago`;
    if (diffDays < 14) return "Added last week";
    if (diffDays < 30) return `Added ${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 60) return "Added last month";
    const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ];
    return `Added ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function Home() {
    const router = useRouter();
    const { theme, toggleTheme } = useReadingTheme();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isOnline = useOnlineStatus();
    const [isUploading, setIsUploading] = useState(false);
    const [filter, setFilter] = useState<LibraryFilter>("all");
    const [offlineActionBookId, setOfflineActionBookId] = useState<
        string | null
    >(null);

    const renderLibraryFilterSwitch = () => (
        <div
            className="library-filter-switch"
            role="radiogroup"
            aria-label="Filter library"
        >
            {LIBRARY_FILTERS.map(({ value, label }) => (
                <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={filter === value}
                    onClick={() => setFilter(value)}
                    className="library-filter-switch__option"
                    data-active={filter === value}
                >
                    {label}
                </button>
            ))}
        </div>
    );

    const { data: booksData, refetch: refetchBooks } = useQuery({
        queryKey: [apiUrl("/api/books")],
        queryFn: fetchLibrary,
    });

    const { data: offlineBooks = [], refetch: refetchOfflineBooks } = useQuery({
        queryKey: ["offline-books"],
        queryFn: listOfflineBooks,
    });

    useEffect(() => {
        if (isOnline) void refetchBooks();
    }, [isOnline, refetchBooks]);

    const offlineBookIds = useMemo(
        () => new Set(offlineBooks.map((record) => record.bookId)),
        [offlineBooks]
    );

    const queryClient = useQueryClient();

    const { mutate: uploadFile } = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch(apiUrl("/api/books"), {
                method: "POST",
                credentials: "include",
                body: formData,
            });
            if (!response.ok) throw new Error("Failed to upload file");
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: [apiUrl("/api/books")],
            });
            toast.success("File uploaded successfully");
        },
        onError: () => toast.error("Failed to upload file"),
    });

    const { mutate: deleteItem } = useMutation({
        mutationFn: async (itemId: string) => {
            const response = await fetch(apiUrl(`/api/books/${itemId}`), {
                method: "DELETE",
                credentials: "include",
            });
            if (!response.ok) throw new Error("Failed deleting file");
            return response;
        },
        onSuccess: async (_response, itemId) => {
            await Promise.all([
                removeOfflineBook(itemId),
                removeOfflineProgress(itemId),
            ]);
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: [apiUrl("/api/books")],
                }),
                refetchOfflineBooks(),
            ]);
            toast.success("Book deleted successfully");
        },
        onError: (err) => toast.error(err.message),
    });

    const downloadBook = async (book: Book) => {
        setOfflineActionBookId(book.id);
        try {
            const firstDownload = offlineBooks.length === 0;
            const response = await fetch(apiUrl(`/api/books/${book.id}`), {
                credentials: "include",
            });
            if (response.status === 401 || response.status === 403) {
                throw new Error("You no longer have access to this book.");
            }
            if (!response.ok) throw new Error("Could not download this book.");
            await storeOfflineBook(book, await response.blob());
            if (firstDownload) await requestPersistentStorage();
            await refetchOfflineBooks();
            toast.success("Book saved for offline reading.");
        } catch (error) {
            const message =
                error instanceof DOMException &&
                error.name === "QuotaExceededError"
                    ? "Not enough device storage to download this book."
                    : error instanceof Error &&
                        (error.message ===
                            "You no longer have access to this book." ||
                            error.message === "Could not download this book.")
                      ? error.message
                      : "Could not download this book.";
            toast.error(message);
        } finally {
            setOfflineActionBookId(null);
        }
    };

    const removeDownload = async (bookId: string) => {
        setOfflineActionBookId(bookId);
        try {
            await removeOfflineBook(bookId);
            const progress = await getOfflineProgress(bookId);
            if (progress && !progress.dirty) {
                await removeOfflineProgress(bookId);
            }
            await refetchOfflineBooks();
            toast.success("Download removed.");
        } finally {
            setOfflineActionBookId(null);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const validExtensions = [".epub", ".pdf"];
        if (
            !validExtensions.some((ext) =>
                file.name.toLowerCase().endsWith(ext)
            )
        ) {
            toast.error("Please upload an EPUB or PDF file");
            return;
        }
        setIsUploading(true);
        uploadFile(file, { onSettled: () => setIsUploading(false) });
        e.target.value = "";
    };

    const allBooks: Book[] = booksData?.books ?? [];
    const sortedBooks = [...allBooks].sort(
        (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const recentBook = sortedBooks[0] ?? null;
    const filteredBooks =
        filter === "all"
            ? sortedBooks
            : sortedBooks.filter((b) => b.fileType === filter);

    const handleBookClick = (book: Book) => {
        router.push(
            offlineBookIds.has(book.id)
                ? createOfflineReaderPath(book)
                : createReaderPath(book)
        );
    };

    return (
        <div
            className="mentarie-shell flex flex-col md:flex-row"
            data-reading-theme={theme}
        >
            <nav className="library-rail sticky top-0 z-[var(--z-sticky)] flex items-center justify-between gap-4 px-4 py-3 md:hidden">
                <div className="library-mobile-wordmark mentarie-wordmark flex shrink-0 items-center gap-2">
                    <span className="mentarie-mark" aria-hidden="true" />
                    Mentarie
                </div>
                {renderLibraryFilterSwitch()}
            </nav>

            <aside className="library-rail fixed inset-y-0 left-0 z-[var(--z-sticky)] hidden w-64 flex-col p-6 md:flex lg:w-72 lg:p-8">
                <div className="mentarie-wordmark flex items-center gap-3">
                    <span className="mentarie-mark" aria-hidden="true" />
                    Mentarie
                </div>
                <p className="mt-3 max-w-[18rem] text-sm leading-relaxed text-[var(--color-chat-muted)]">
                    Read closely. Ask beyond the page.
                </p>
                <nav className="mt-12 grid gap-2" aria-label="Library filters">
                    <button
                        type="button"
                        onClick={() => setFilter("all")}
                        className="library-nav-button"
                    >
                        <LibraryBig className="h-5 w-5" />
                        All books
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter("epub")}
                        className="library-filter"
                        data-active={filter === "epub"}
                    >
                        <BookOpenText className="h-5 w-5" />
                        EPUB
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter("pdf")}
                        className="library-filter"
                        data-active={filter === "pdf"}
                    >
                        <FileText className="h-5 w-5" />
                        PDF
                    </button>
                </nav>
                <p className="mt-auto text-xs leading-relaxed text-[var(--color-chat-muted)]">
                    Your questions stay attached to the book that sparked them.
                </p>
            </aside>

            <main className="library-main min-h-[100dvh] flex-1 md:ml-64 lg:ml-72">
                <header className="library-header sticky top-[68px] z-[var(--z-sticky)] flex flex-col gap-5 border-b border-[var(--color-rule)] px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-8 md:top-0 lg:px-12 lg:py-8">
                    <div>
                        <h1 className="library-title">Your reading room</h1>
                        <p className="library-copy mt-2">
                            Open a book, keep your place, and ask for the
                            context the page assumes you already know.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <ReadingThemeToggle
                            theme={theme}
                            onToggle={toggleTheme}
                        />
                        <button
                            type="button"
                            onClick={() => router.push("/settings/ai")}
                            className="secondary-button"
                        >
                            <Settings className="h-4 w-4" />
                            Settings
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".epub,.pdf"
                            onChange={handleFileChange}
                            className="sr-only"
                            aria-label="Choose an EPUB or PDF"
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                            className="primary-button"
                        >
                            <Upload className="h-4 w-4" />
                            {isUploading ? "Uploading…" : "Upload book"}
                        </button>
                        <button
                            type="button"
                            onClick={async () => {
                                await signOut();
                                router.push("/login");
                            }}
                            className="secondary-button"
                        >
                            <LogOut className="h-4 w-4" />
                            Sign out
                        </button>
                    </div>
                </header>

                <div className="px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
                    {booksData?.offlineFallback && (
                        <div
                            className="mb-8 border border-[var(--color-rule)] bg-[var(--color-paper-raised)] px-4 py-3 text-sm text-[var(--color-ink-2)]"
                            role="status"
                        >
                            Offline — showing books saved on this device.
                        </div>
                    )}
                    {recentBook && filter === "all" && (
                        <section
                            className="mb-14"
                            aria-labelledby="continue-reading-title"
                        >
                            <div className="mb-5 flex items-center gap-3">
                                <Clock3 className="h-5 w-5 text-[var(--color-focus)]" />
                                <h2
                                    id="continue-reading-title"
                                    className="text-xl font-bold tracking-[-0.025em]"
                                >
                                    Continue reading
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleBookClick(recentBook)}
                                className="recent-book text-left"
                            >
                                <BookCover
                                    book={recentBook}
                                    className="recent-book__cover"
                                    iconClassName="h-6 w-6"
                                />
                                <span className="recent-book__details">
                                    <span>
                                        <span className="file-chip">
                                            {recentBook.fileType ?? "epub"}
                                        </span>
                                        <span className="recent-book__title">
                                            {recentBook.title}
                                        </span>
                                    </span>
                                    <span className="book-meta flex items-center gap-2 text-[var(--color-ink-2)]">
                                        <Clock3 className="h-4 w-4" />
                                        {formatRelativeDate(
                                            recentBook.createdAt
                                        )}
                                    </span>
                                </span>
                            </button>
                        </section>
                    )}

                    <section aria-labelledby="library-books-title">
                        <div className="mb-6 flex items-end justify-between gap-4">
                            <div>
                                <h2
                                    id="library-books-title"
                                    className="text-2xl font-bold tracking-[-0.03em]"
                                >
                                    {filter === "all"
                                        ? "All books"
                                        : filter === "epub"
                                          ? "EPUB books"
                                          : "PDF books"}
                                </h2>
                                <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                                    {filteredBooks.length}{" "}
                                    {filteredBooks.length === 1
                                        ? "book"
                                        : "books"}
                                </p>
                            </div>
                        </div>

                        {filteredBooks.length === 0 ? (
                            <div className="empty-library">
                                <LibraryBig className="mx-auto h-9 w-9 text-[var(--color-ink-2)]" />
                                <h3 className="mt-4 text-lg font-bold">
                                    No books here yet
                                </h3>
                                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--color-ink-2)]">
                                    {booksData?.offlineFallback
                                        ? "No downloaded books are available offline."
                                        : filter === "all"
                                          ? "Add an EPUB or PDF to start reading and asking questions."
                                          : `Your library has no ${filter.toUpperCase()} books.`}
                                </p>
                                {filter === "all" &&
                                    !booksData?.offlineFallback && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                fileInputRef.current?.click()
                                            }
                                            className="primary-button mt-6"
                                        >
                                            <Upload className="h-4 w-4" />
                                            Upload book
                                        </button>
                                    )}
                            </div>
                        ) : (
                            <div className="book-grid">
                                {filteredBooks.map((book) => (
                                    <article
                                        key={book.id}
                                        className="book-card group relative"
                                    >
                                        <button
                                            type="button"
                                            onClick={() =>
                                                handleBookClick(book)
                                            }
                                            className="book-card__open text-left"
                                            aria-label={`Open ${book.title}`}
                                        >
                                            <BookCover
                                                book={book}
                                                className="book-card__cover"
                                                iconClassName="h-8 w-8"
                                            />
                                            <span className="book-card__body">
                                                <span className="file-chip">
                                                    {book.fileType ?? "epub"}
                                                </span>
                                                <span className="book-card__title line-clamp-2">
                                                    {book.title}
                                                </span>
                                                <span className="book-meta flex items-center gap-2 text-[var(--color-ink-2)]">
                                                    <Clock3 className="h-4 w-4" />
                                                    {formatRelativeDate(
                                                        book.createdAt
                                                    )}
                                                </span>
                                            </span>
                                        </button>
                                        <div className="book-card__actions">
                                            {offlineBookIds.has(book.id) ? (
                                                <>
                                                    <span className="book-card__offline-status">
                                                        <Check className="h-3.5 w-3.5" />
                                                        Saved offline
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className="secondary-button book-card__action"
                                                        disabled={
                                                            offlineActionBookId ===
                                                            book.id
                                                        }
                                                        onClick={() =>
                                                            void removeDownload(
                                                                book.id
                                                            )
                                                        }
                                                    >
                                                        <X className="h-4 w-4" />
                                                        {offlineActionBookId ===
                                                        book.id
                                                            ? "Removing…"
                                                            : "Remove download"}
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="secondary-button book-card__action"
                                                    disabled={
                                                        offlineActionBookId ===
                                                        book.id
                                                    }
                                                    onClick={() =>
                                                        void downloadBook(book)
                                                    }
                                                >
                                                    <Download className="h-4 w-4" />
                                                    {offlineActionBookId ===
                                                    book.id
                                                        ? "Downloading…"
                                                        : "Download"}
                                                </button>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            className="book-delete absolute right-4 top-4 bg-[var(--color-paper-raised)]"
                                            onClick={() => deleteItem(book.id)}
                                            aria-label={`Delete ${book.title}`}
                                            title="Delete book"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </main>
        </div>
    );
}

export default function Page() {
    return (
        <AuthProtection>
            <Home />
        </AuthProtection>
    );
}
