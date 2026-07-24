"use client";

import React, { memo, useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { loadBookBlob } from "@/lib/bookBinary";

interface PdfReaderProps {
    bookId: string;
    url: string;
    requireLocal?: boolean;
}

const PdfReader: React.FC<PdfReaderProps> = memo(
    ({ bookId, url, requireLocal = false }) => {
        const [pdfUrl, setPdfUrl] = useState<string | null>(null);
        const [error, setError] = useState<string | null>(null);

        useEffect(() => {
            let objectUrl: string | null = null;
            const abortController = new AbortController();
            let cancelled = false;

            const loadPdf = async () => {
                try {
                    setError(null);
                    setPdfUrl(null);

                    const { blob } = await loadBookBlob({
                        bookId,
                        url,
                        requireLocal,
                        signal: abortController.signal,
                    });
                    objectUrl = URL.createObjectURL(
                        blob.type === "application/pdf"
                            ? blob
                            : new Blob([blob], { type: "application/pdf" })
                    );

                    if (cancelled) {
                        URL.revokeObjectURL(objectUrl);
                        return;
                    }

                    setPdfUrl(objectUrl);
                } catch (err) {
                    if (!cancelled) {
                        setError(
                            err instanceof Error
                                ? err.message
                                : "Failed to load PDF"
                        );
                    }
                }
            };

            loadPdf();

            return () => {
                cancelled = true;
                abortController.abort();
                if (objectUrl) {
                    URL.revokeObjectURL(objectUrl);
                }
            };
        }, [bookId, requireLocal, url]);

        if (error) {
            return (
                <div className="p-4 text-[var(--color-accent-3)]">{error}</div>
            );
        }

        if (!pdfUrl) {
            return <LoadingSpinner />;
        }

        return (
            <div className="h-full bg-[var(--color-paper-2)]">
                <iframe
                    src={pdfUrl}
                    title="PDF reader"
                    className="h-full w-full border-0"
                />
            </div>
        );
    }
);

PdfReader.displayName = "PdfReader";

export default PdfReader;
