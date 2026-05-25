"use client";

import { useParams, useSearchParams } from "next/navigation";
import EpubReader from "@/components/reader/EpubReader";
import PdfReader from "@/components/reader/PdfReader";
import { useWindowSize } from "@/hooks/useWindowSize";
import { ChatInterface } from "@/components/reader/ChatInterface";

export default function Reader() {
    const params = useParams();
    const bookFileKey = params.id as string | null;
    const { width } = useWindowSize();
    const isMobile = width < 768;
    const searchParams = useSearchParams();
    const bookId = searchParams.get("bookId");
    const fileType = searchParams.get("type");
    const isPdf = fileType === "pdf" || bookFileKey?.startsWith("pdf-");
    const bookUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/books/${bookFileKey}`;

    return (
        <div className="min-h-[100dvh] bg-[#2b2b31] p-0 text-[#1a1c1c] md:flex md:items-center md:justify-center md:p-8">
            <div
                className={`relative flex h-[100dvh] w-full overflow-hidden bg-transparent shadow-2xl md:h-[90vh] md:max-w-[1400px] md:gap-3 md:rounded-xl ${
                    isMobile ? "flex-col" : "justify-center"
                }`}
            >
                {!isMobile && (
                    <div className="w-[40%] min-w-[360px] overflow-hidden rounded-xl bg-[#343541]">
                        <ChatInterface isMobile={false} bookId={bookId ?? ""} />
                    </div>
                )}
                {isMobile ? (
                    <div
                        className="relative h-full w-full overflow-hidden bg-[#f9f9f9]"
                    >
                        {isPdf ? (
                            <PdfReader url={bookUrl} />
                        ) : (
                            <EpubReader url={bookUrl} />
                        )}
                        <ChatInterface isMobile={true} bookId={bookId ?? ""} />
                    </div>
                ) : (
                    <div
                        className="relative w-[60%] overflow-hidden rounded-xl bg-[#f9f9f9]"
                    >
                        {isPdf ? (
                            <PdfReader url={bookUrl} />
                        ) : (
                            <EpubReader url={bookUrl} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
