"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import EpubReader from "@/components/reader/EpubReader";
import PdfReader from "@/components/reader/PdfReader";
import { useWindowSize } from "@/hooks/useWindowSize";
import { ChatInterface } from "@/components/reader/ChatInterface";
import { ArrowLeft, ArrowLeftRight, GripVertical } from "lucide-react";
import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type PointerEvent,
} from "react";
import type { HighlightContext } from "@/types/highlightContext";

type ChatSidebarSide = "left" | "right";

const CHAT_SIDEBAR_STORAGE_KEY = "reader.chatSidebarSide";
const CHAT_SIDEBAR_DRAG_THRESHOLD = 8;
const CHAT_SIDEBAR_HINT_DURATION_MS = 1100;

const isChatSidebarSide = (value: string | null): value is ChatSidebarSide =>
    value === "left" || value === "right";

export default function Reader() {
    const router = useRouter();
    const params = useParams();
    const bookFileKey = params.id as string | null;
    const { width } = useWindowSize();
    const isMobile = width < 768;
    const searchParams = useSearchParams();
    const bookId = searchParams.get("bookId");
    const fileType = searchParams.get("type");
    const [highlightContext, setHighlightContext] =
        useState<HighlightContext | null>(null);
    const [chatSidebarSide, setChatSidebarSideState] =
        useState<ChatSidebarSide>("left");
    const [isSidebarDragHintVisible, setIsSidebarDragHintVisible] =
        useState(false);
    const readerShellRef = useRef<HTMLDivElement>(null);
    const sidebarDragStartXRef = useRef<number | null>(null);
    const sidebarHasDraggedRef = useRef(false);
    const sidebarSuppressClickRef = useRef(false);
    const sidebarHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );
    const isPdf = fileType === "pdf" || bookFileKey?.startsWith("pdf-");
    const bookUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/books/${bookFileKey}`;

    useEffect(() => {
        const storedSide = localStorage.getItem(CHAT_SIDEBAR_STORAGE_KEY);
        if (isChatSidebarSide(storedSide)) {
            setChatSidebarSideState(storedSide);
        }
    }, []);

    useEffect(
        () => () => {
            if (sidebarHintTimeoutRef.current) {
                clearTimeout(sidebarHintTimeoutRef.current);
            }
        },
        []
    );

    const setChatSidebarSide = (side: ChatSidebarSide) => {
        setChatSidebarSideState(side);
        localStorage.setItem(CHAT_SIDEBAR_STORAGE_KEY, side);
    };

    const toggleChatSidebarSide = () => {
        setChatSidebarSide(chatSidebarSide === "left" ? "right" : "left");
    };

    const clearSidebarHintTimeout = () => {
        if (sidebarHintTimeoutRef.current) {
            clearTimeout(sidebarHintTimeoutRef.current);
            sidebarHintTimeoutRef.current = null;
        }
    };

    const showSidebarDragHint = (durationMs?: number) => {
        clearSidebarHintTimeout();
        setIsSidebarDragHintVisible(true);

        if (durationMs) {
            sidebarHintTimeoutRef.current = setTimeout(() => {
                setIsSidebarDragHintVisible(false);
                sidebarHintTimeoutRef.current = null;
            }, durationMs);
        }
    };

    const hideSidebarDragHint = () => {
        clearSidebarHintTimeout();
        setIsSidebarDragHintVisible(false);
    };

    const handleBack = () => {
        if (window.history.length > 1) {
            router.back();
            return;
        }

        router.push("/");
    };

    const handleSidebarPointerDown = (
        event: PointerEvent<HTMLButtonElement>
    ) => {
        if (event.button !== 0) return;

        sidebarDragStartXRef.current = event.clientX;
        sidebarHasDraggedRef.current = false;
        showSidebarDragHint();
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleSidebarPointerMove = (
        event: PointerEvent<HTMLButtonElement>
    ) => {
        const startX = sidebarDragStartXRef.current;
        if (startX === null) return;

        if (
            Math.abs(event.clientX - startX) >= CHAT_SIDEBAR_DRAG_THRESHOLD
        ) {
            sidebarHasDraggedRef.current = true;
        }
    };

    const handleSidebarPointerUp = (
        event: PointerEvent<HTMLButtonElement>
    ) => {
        const startX = sidebarDragStartXRef.current;
        sidebarDragStartXRef.current = null;

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        const didDrag = sidebarHasDraggedRef.current;
        sidebarSuppressClickRef.current = didDrag;

        if (startX === null) {
            hideSidebarDragHint();
            return;
        }

        if (!didDrag) {
            showSidebarDragHint(CHAT_SIDEBAR_HINT_DURATION_MS);
            return;
        }

        const shell = readerShellRef.current;
        if (!shell) {
            hideSidebarDragHint();
            return;
        }

        const { left, width: shellWidth } = shell.getBoundingClientRect();
        const midpoint = left + shellWidth / 2;
        setChatSidebarSide(event.clientX < midpoint ? "left" : "right");
        hideSidebarDragHint();
    };

    const handleSidebarPointerCancel = (
        event: PointerEvent<HTMLButtonElement>
    ) => {
        sidebarDragStartXRef.current = null;
        sidebarHasDraggedRef.current = false;
        hideSidebarDragHint();

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleSidebarHandleClick = () => {
        if (sidebarSuppressClickRef.current) {
            sidebarSuppressClickRef.current = false;
            return;
        }

        requestAnimationFrame(() => {
            showSidebarDragHint(CHAT_SIDEBAR_HINT_DURATION_MS);
        });
    };

    const handleSidebarHandleKeyDown = (
        event: KeyboardEvent<HTMLButtonElement>
    ) => {
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            setChatSidebarSide("left");
            return;
        }

        if (event.key === "ArrowRight") {
            event.preventDefault();
            setChatSidebarSide("right");
            return;
        }

        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleChatSidebarSide();
        }
    };

    const desktopChatPane = (
        <div
            key="desktop-chat-pane"
            className={`relative w-[40%] min-w-[360px] overflow-visible ${
                chatSidebarSide === "left" ? "order-1" : "order-3"
            }`}
        >
            <div className="h-full overflow-hidden rounded-xl bg-[#343541]">
                <ChatInterface
                    isMobile={false}
                    bookId={bookId ?? ""}
                    onBack={handleBack}
                    highlightContext={highlightContext}
                    onClearHighlightContext={() => setHighlightContext(null)}
                />
            </div>
            <button
                type="button"
                onPointerDown={handleSidebarPointerDown}
                onPointerMove={handleSidebarPointerMove}
                onPointerUp={handleSidebarPointerUp}
                onPointerCancel={handleSidebarPointerCancel}
                onClick={handleSidebarHandleClick}
                onKeyDown={handleSidebarHandleKeyDown}
                aria-label={`Move chat sidebar ${chatSidebarSide === "left" ? "right" : "left"}`}
                className={`absolute top-1/2 z-[75] flex h-16 w-5 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full border border-white/10 bg-[#2b2c32] text-white/75 shadow-lg transition-colors hover:bg-[#25262d] hover:text-white active:cursor-grabbing ${
                    chatSidebarSide === "left" ? "-right-2.5" : "-left-2.5"
                }`}
            >
                {isSidebarDragHintVisible && (
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-1/2 top-1/2 flex h-8 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#2b2c32]/95 text-white shadow-xl"
                    >
                        <span className="absolute left-2 h-1.5 w-1.5 animate-ping rounded-full bg-white/80" />
                        <ArrowLeftRight className="h-4 w-4 animate-pulse" />
                        <span className="absolute right-2 h-1.5 w-1.5 animate-ping rounded-full bg-white/80" />
                    </span>
                )}
                <GripVertical className="h-4 w-4" />
            </button>
        </div>
    );

    const desktopViewerPane = (
        <div
            key="desktop-viewer-pane"
            className="relative order-2 w-[60%] overflow-hidden rounded-xl bg-[#f9f9f9]"
        >
            {isPdf ? (
                <PdfReader url={bookUrl} />
            ) : (
                <EpubReader
                    url={bookUrl}
                    onAddHighlightContext={(text) =>
                        setHighlightContext({
                            sourceType: "epub",
                            text,
                        })
                    }
                />
            )}
        </div>
    );

    return (
        <div className="min-h-[100dvh] bg-[#2b2b31] p-0 text-[#1a1c1c] md:flex md:items-center md:justify-center md:p-[2.5dvh]">
            <div
                ref={readerShellRef}
                className={`relative flex h-[100dvh] w-full overflow-hidden bg-transparent shadow-2xl md:h-[95dvh] md:w-[95vw] md:gap-3 md:rounded-xl ${
                    isMobile ? "flex-col" : "justify-center"
                }`}
            >
                {isMobile ? (
                    <div className="relative h-full w-full overflow-hidden bg-[#f9f9f9]">
                        <button
                            type="button"
                            onClick={handleBack}
                            className="absolute left-4 top-4 z-[70] flex h-11 w-11 items-center justify-center rounded-full bg-[#343541]/90 text-white shadow-lg transition-colors hover:bg-[#343541]"
                            aria-label="Back to library"
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </button>
                        {isPdf ? (
                            <PdfReader url={bookUrl} />
                        ) : (
                            <EpubReader url={bookUrl} />
                        )}
                        <ChatInterface isMobile={true} bookId={bookId ?? ""} />
                    </div>
                ) : (
                    <>
                        {desktopChatPane}
                        {desktopViewerPane}
                    </>
                )}
            </div>
        </div>
    );
}
