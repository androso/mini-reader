"use client";

import ReaderWorkspace from "@/components/reader/ReaderWorkspace";
import { parseOfflineReaderHash } from "@/lib/bookReaderRouting";
import Link from "next/link";
import { useEffect, useState } from "react";

type OfflineReaderTarget = {
    bookId: string;
    fileType: "epub" | "pdf";
};

export default function OfflineReaderPage() {
    const [target, setTarget] = useState<
        OfflineReaderTarget | null | undefined
    >(undefined);

    useEffect(() => {
        setTarget(parseOfflineReaderHash(window.location.hash));
    }, []);

    if (target === undefined) return null;
    if (target === null) {
        return (
            <main className="reader-workspace flex min-h-[100dvh] items-center justify-center p-6">
                <div className="reader-chat-pane max-w-md rounded-[var(--radius-panel)] p-8 text-center">
                    <p>This offline book link is invalid.</p>
                    <Link
                        href="/"
                        className="secondary-button mt-6 inline-flex"
                    >
                        Return to library
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <ReaderWorkspace
            bookId={target.bookId}
            fileType={target.fileType}
            requireLocalBook
        />
    );
}
