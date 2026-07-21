"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import type { Book } from "@/types/bookTypes";
import { apiUrl } from "@/lib/api";
import { resolveRelativePath } from "@/lib/utils";
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

const imageMimeTypes: Record<string, string> = {
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
};

const getMimeType = (path: string) => {
    const extension = path.split(".").pop()?.toLowerCase();
    return extension
        ? (imageMimeTypes[extension] ?? "image/jpeg")
        : "image/jpeg";
};

const getOpfPath = async (zip: JSZip) => {
    const containerXml = await zip
        .file("META-INF/container.xml")
        ?.async("text");
    if (!containerXml) return null;

    const container = new DOMParser().parseFromString(
        containerXml,
        "application/xml"
    );
    return (
        container
            .querySelector("rootfile")
            ?.getAttribute("full-path")
            ?.trim() || null
    );
};

const getCoverPathFromOpf = (opfContent: string) => {
    const opf = new DOMParser().parseFromString(opfContent, "application/xml");
    const coverImageItem = opf.querySelector(
        "manifest > item[properties~='cover-image']"
    );
    if (coverImageItem?.getAttribute("href")) {
        return coverImageItem.getAttribute("href");
    }

    const coverId = opf
        .querySelector("metadata > meta[name='cover']")
        ?.getAttribute("content");
    if (coverId) {
        const coverItem = opf.querySelector(
            `manifest > item[id="${CSS.escape(coverId)}"]`
        );
        if (coverItem?.getAttribute("href")) {
            return coverItem.getAttribute("href");
        }
    }

    return opf
        .querySelector("manifest > item[media-type^='image/']")
        ?.getAttribute("href");
};

const extractEpubCoverUrl = async (file: Blob) => {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const opfPath = await getOpfPath(zip);
    if (!opfPath) return null;

    const opfContent = await zip.file(opfPath)?.async("text");
    if (!opfContent) return null;

    const coverPath = getCoverPathFromOpf(opfContent);
    if (!coverPath) return null;

    const opfBasePath = opfPath.includes("/")
        ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
        : "";
    const resolvedCoverPath = resolveRelativePath(coverPath, opfBasePath);
    const coverFile = zip.file(resolvedCoverPath) ?? zip.file(coverPath);
    if (!coverFile) return null;

    const coverBlob = new Blob([await coverFile.async("arraybuffer")], {
        type: getMimeType(resolvedCoverPath),
    });
    return URL.createObjectURL(coverBlob);
};

export default function BookCover({
    book,
    className = "",
    iconClassName = "h-10 w-10",
}: BookCoverProps) {
    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

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
            fileType: book.fileType,
            target,
            createObserver,
            createAbortController: () => new AbortController(),
            loadCover: (signal) =>
                fetchProtectedEpubCover(book.id, signal, {
                    buildApiUrl: apiUrl,
                    extractCoverUrl: extractEpubCoverUrl,
                    fetch,
                }),
            onCoverUrl: setCoverUrl,
            onError: (error) => {
                console.warn("Failed to load EPUB cover", {
                    bookId: book.id,
                    error,
                });
            },
            revokeObjectUrl: URL.revokeObjectURL,
        });
    }, [book.fileType, book.id]);

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
                    className="h-full w-full object-cover"
                />
            ) : (
                <div
                    className={`absolute inset-0 grid place-items-center ${
                        book.fileType === "pdf"
                            ? "bg-[var(--color-accent-3-soft)]"
                            : "bg-[var(--color-accent-2-soft)]"
                    }`}
                >
                    {book.fileType === "pdf" ? (
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
