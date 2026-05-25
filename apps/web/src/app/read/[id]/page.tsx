"use client";

import { useParams, useSearchParams } from "next/navigation";
import EpubReader from "@/components/reader/EpubReader";
import { useWindowSize } from "@/hooks/useWindowSize";
import { ChatInterface } from "@/components/reader/ChatInterface";

export default function Reader() {
    const params = useParams();
    const bookFileKey = params.id as string | null;
    const { width } = useWindowSize();
    const isMobile = width < 768;
    const searchParams = useSearchParams();
    const bookId = searchParams.get("bookId");

    return (
        <div className="h-[100dvh] bg-[#D7D7D7] ">
            <div
                className={`h-[100dvh] w-full rounded-lg relative flex justify-center ${!isMobile && "p-8"}`}
            >
                {!isMobile && (
                    <div className="w-[40%] bg-[#FCFCFC] mr-4 rounded-lg">
                        <ChatInterface isMobile={false} bookId={bookId ?? ""} />
                    </div>
                )}
                {isMobile ? (
                    <div
                        className={`w-full relative overflow-hidden bg-[#FCFCFC] rounded-lg`}
                    >
                        <EpubReader
                            url={`${process.env.NEXT_PUBLIC_API_URL}/api/books/${bookFileKey}`}
                        />
                        <ChatInterface isMobile={true} bookId={bookId ?? ""} />
                    </div>
                ) : (
                    <div
                        className={`w-[60%] relative overflow-hidden bg-[#FCFCFC] rounded-lg`}
                    >
                        <EpubReader
                            url={`${process.env.NEXT_PUBLIC_API_URL}/api/books/${bookFileKey}`}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
