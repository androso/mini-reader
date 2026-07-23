"use client";

import { useEffect, useRef, useState } from "react";
import type { Book } from "@/types/bookTypes";
import { apiUrl } from "@/lib/api";
import { extractEpubCover } from "@/lib/epubCoverExtraction";
import { resolveBookFileKind } from "@/lib/bookFileKind";
import {
    fetchProtectedEpubCover,
    startLazyBookCoverLoad,
    type VisibilityObserverFactory,
} from "./bookCoverLoading";
import { BookOpenText, FileText } from "lucide-react";

interface BookCoverProps {
    book: Book;
    className?: string;
    iconClassName?: string;
}

export default function BookCover({
    book,
    className = "",
    iconClassName = "h-10 w-10",
}: BookCoverProps) {
    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fileKind = resolveBookFileKind(book);

    useEffect(() => {
        const target = containerRef.current;
        if (!target) return;

        const createObserver: VisibilityObserverFactory | undefined =
            typeof IntersectionObserver === "undefined"
                ? undefined
                : (onEntries, observerOptions) => {
                      const observer = new IntersectionObserver(
                          (entries) => onEntries(entries),
                          observerOptions
                      );
                      return {
                          disconnect: () => observer.disconnect(),
                          observe: (element) =>
                              observer.observe(element as Element),
                      };
                  };

        return startLazyBookCoverLoad({
            bookId: book.id,
            fileType: book.fileType,
            title: book.title,
            target,
            createObserver,
            createAbortController: () => new AbortController(),
            loadCover: (signal) =>
                fetchProtectedEpubCover(book.id, signal, {
                    buildApiUrl: apiUrl,
                    extractCover: extractEpubCover,
                    // window.fetch must keep its receiver; passing the bare
                    // function through dependency injection throws Illegal invocation.
                    fetch: globalThis.fetch.bind(globalThis),
                }),
            createObjectUrl: (blob) => URL.createObjectURL(blob),
            onCoverUrl: setCoverUrl,
            onError: (error) => {
                console.warn("Failed to load EPUB cover", {
                    bookId: book.id,
                    error,
                });
            },
            revokeObjectUrl: (url) => URL.revokeObjectURL(url),
        });
    }, [book.fileType, book.id, book.title]);

    return (
        <div
            ref={containerRef}
            className={`relative flex items-center justify-center overflow-hidden bg-surface-container shadow-sm ${className}`}
        >
            {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={coverUrl}
                    alt={`${book.title} cover`}
                    className="h-full w-full object-contain"
                />
            ) : (
                <div
                    className={`absolute inset-0 grid place-items-center ${
                        fileKind === "pdf"
                            ? "bg-[var(--color-accent-3-soft)]"
                            : "bg-[var(--color-accent-2-soft)]"
                    }`}
                >
                    {fileKind === "pdf" ? (
                        <FileText
                            className={`text-[var(--color-ink-2)] ${iconClassName}`}
                            aria-hidden="true"
                        />
                    ) : (
                        <BookOpenText
                            className={`text-[var(--color-ink-2)] ${iconClassName}`}
                            aria-hidden="true"
                        />
                    )}
                </div>
            )}
        </div>
    );
}
