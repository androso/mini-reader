import React, { useEffect, useRef, memo } from "react";
import { ArrowLeft, Menu, MessageCirclePlus } from "lucide-react";
import Sidebar from "./Sidebar";
import { useEpubProcessor } from "@/hooks/useEpubProcessor";
import { useChapterLoader } from "@/hooks/useChapterLoader";
import { useTextBlockNavigation } from "@/hooks/useTextBlockNavigation";
import { useTextSelection } from "@/hooks/useTextSelection";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import Chapter from "./Chapter";
import type { Chapter as EpubChapter } from "@/hooks/useChapterLoader";
import { findChapterByHref } from "@/lib/epubNavigation";
import { getNextChapter, isLastChapter } from "@/lib/readerNavigationBounds";

interface EpubReaderProps {
    url: string;
    bookId: string;
    onBack?: () => void;
    onAddHighlightContext?: (text: string) => void;
}

const EpubReader = memo(
    ({ url, bookId, onBack, onAddHighlightContext }: EpubReaderProps) => {
        const { processEpub, isLoading, error, epubContent, zipData } =
            useEpubProcessor();
        const contentRef = useRef<HTMLDivElement>(null);
        const {
            tooltipRef,
            tooltipPosition,
            isVisible: isSelectionActionVisible,
            selectedText,
            clearSelection,
        } = useTextSelection({
            containerRef: contentRef,
            enabled: Boolean(onAddHighlightContext),
        });
        const { chapters, loadAllChapters, flatTextBlocks } = useChapterLoader(
            epubContent,
            zipData
        );
        const [activeChapter, setActiveChapter] =
            React.useState<EpubChapter | null>(null);
        const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
        const [activeHref, setActiveHref] = React.useState<string | null>(null);
        const { activeTextBlockId, isLoading: textBlockIsLoading } =
            useTextBlockNavigation(flatTextBlocks, contentRef, bookId);

        const handleTocItemClick = (hrefId: string) => {
            const targetChapter = findChapterByHref(chapters, hrefId);
            if (!targetChapter) {
                console.warn(`No chapter found for TOC href: ${hrefId}`);
                return;
            }

            setActiveChapter(targetChapter);
            setActiveHref(hrefId);
            setTimeout(() => {
                contentRef.current?.parentElement?.scrollTo({
                    top: 0,
                    behavior: "smooth",
                });
            }, 100);
        };

        useEffect(() => {
            processEpub(url);
        }, [url, processEpub]);

        useEffect(() => {
            if (epubContent && zipData) {
                loadAllChapters();
            }
        }, [epubContent, zipData, loadAllChapters]);

        // Set initial activeHref based on activeTextBlockId
        useEffect(() => {
            if (
                !textBlockIsLoading &&
                activeTextBlockId &&
                chapters.length > 0
            ) {
                const chapterId = activeTextBlockId.split("-")[0];
                const chapter = chapters.find(
                    (c) =>
                        c.hrefId.includes(chapterId) || c.id.includes(chapterId)
                );
                if (chapter && !activeHref) {
                    setActiveChapter(chapter);
                    setActiveHref(chapter.hrefId);
                    // Give time for the chapter to render before scrolling
                    setTimeout(() => {
                        const element =
                            document.getElementById(activeTextBlockId);
                        if (element) {
                            element.scrollIntoView({
                                behavior: "smooth",
                                block: "center",
                            });
                        }
                    }, 100);
                }
            }
        }, [textBlockIsLoading, activeTextBlockId, chapters]);

        if (isLoading) {
            return (
                <div className="loading-spinner">
                    <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-accent-2)] border-b-transparent border-l-transparent" />
                    <div className="mt-4 text-lg text-[var(--color-ink-2)]">
                        Loading book…
                    </div>
                </div>
            );
        }

        if (error) {
            return (
                <div className="p-4 text-[var(--color-accent-3)]">{error}</div>
            );
        }

        if (!epubContent || !zipData) {
            return null;
        }

        return (
            <>
                <Sidebar
                    epubContent={epubContent}
                    isOpen={isSidebarOpen}
                    onClose={() => setIsSidebarOpen(false)}
                    onTocItemClick={handleTocItemClick}
                    activeHref={activeHref}
                />

                <div className="relative h-full overflow-x-hidden bg-[var(--color-paper)]">
                    <div className="sticky left-0 right-0 top-0 z-[var(--z-raised)] flex h-[72px] items-center gap-2 bg-[var(--color-paper)] px-6 md:px-10">
                        {onBack && (
                            <button
                                type="button"
                                className="z-[var(--z-raised)] grid h-11 w-11 cursor-pointer place-items-center rounded-[var(--radius-pill)] border-none bg-transparent text-[var(--color-ink-2)] transition-[background-color,color] duration-short hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)]"
                                onClick={onBack}
                                aria-label="Back to library"
                            >
                                <ArrowLeft className="h-6 w-6" />
                            </button>
                        )}
                        <button
                            type="button"
                            className="z-[var(--z-raised)] grid h-11 w-11 cursor-pointer place-items-center rounded-[var(--radius-pill)] border-none bg-transparent text-[var(--color-ink-2)] transition-[background-color,color] duration-short hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)]"
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            aria-label="Open table of contents"
                        >
                            <Menu className="h-6 w-6" />
                        </button>
                    </div>
                    <div className="mx-auto max-h-[calc(100%-72px)] max-w-[720px] overflow-y-auto overflow-x-hidden px-5 md:px-10">
                        <div className="pb-32" ref={contentRef}>
                            {isLoading ||
                            textBlockIsLoading ||
                            !activeChapter ? (
                                <LoadingSpinner />
                            ) : (
                                <Chapter
                                    activeTextblockId={activeTextBlockId}
                                    chapter={activeChapter}
                                    isLastChapter={isLastChapter(
                                        chapters,
                                        activeChapter
                                    )}
                                    onAddHighlightContext={
                                        onAddHighlightContext
                                    }
                                    onNextChapter={() => {
                                        const nextChapter = getNextChapter(
                                            chapters,
                                            activeChapter
                                        );
                                        if (!nextChapter) return;

                                        setActiveChapter(nextChapter);
                                        setActiveHref(nextChapter.hrefId);
                                        setTimeout(() => {
                                            contentRef.current?.scrollIntoView({
                                                behavior: "smooth",
                                            });
                                        }, 100);
                                    }}
                                />
                            )}
                        </div>
                        {onAddHighlightContext &&
                            isSelectionActionVisible &&
                            selectedText && (
                                <div
                                    ref={tooltipRef}
                                    className="fixed z-[var(--z-tooltip)]"
                                    style={{
                                        left: tooltipPosition.x,
                                        top: Math.max(16, tooltipPosition.y),
                                    }}
                                >
                                    <button
                                        type="button"
                                        onMouseDown={(event) =>
                                            event.preventDefault()
                                        }
                                        onClick={() => {
                                            onAddHighlightContext(selectedText);
                                            clearSelection();
                                        }}
                                        className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] bg-[var(--color-chat)] px-4 py-2 text-xs font-semibold text-[var(--color-chat-text)] transition-[background-color,transform] duration-short hover:bg-[var(--color-chat-raised)] active:translate-y-px"
                                    >
                                        <MessageCirclePlus className="h-4 w-4" />
                                        <span>Ask about this</span>
                                    </button>
                                </div>
                            )}
                    </div>
                </div>
            </>
        );
    }
);

EpubReader.displayName = "EpubReader";

export default EpubReader;
