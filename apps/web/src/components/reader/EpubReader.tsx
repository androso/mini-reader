import React, { useCallback, useEffect, useMemo, useRef, memo } from "react";
import { ArrowLeft, Menu, MessageCirclePlus } from "lucide-react";
import Sidebar from "./Sidebar";
import ChapterPullAffordance from "./ChapterPullAffordance";
import { useEpubProcessor } from "@/hooks/useEpubProcessor";
import { useChapterLoader } from "@/hooks/useChapterLoader";
import { useTextBlockNavigation } from "@/hooks/useTextBlockNavigation";
import { useChapterPullNavigation } from "@/hooks/useChapterPullNavigation";
import { useEpubImageHydration } from "@/hooks/useEpubImageHydration";
import { useTextSelection } from "@/hooks/useTextSelection";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import Chapter from "./Chapter";
import type { Chapter as EpubChapter } from "@/hooks/useChapterLoader";
import {
    buildChapterOrder,
    getAdjacentChapterId,
    resolveChapterIdFromProgress,
    resolveTocHrefToSpineId,
    splitEpubHref,
} from "@/lib/epubNavigation";
import type { PullDirection } from "@/lib/chapterPullGesture";

interface EpubReaderProps {
    url: string;
    bookId: string;
    isMobile?: boolean;
    onBack?: () => void;
    onAddHighlightContext?: (text: string) => void;
}

type ScrollLanding = "top" | "bottom" | "block" | "fragment";

const EpubReader = memo(
    ({
        url,
        bookId,
        isMobile = false,
        onBack,
        onAddHighlightContext,
    }: EpubReaderProps) => {
        const { processEpub, isLoading, error, epubContent, zipData } =
            useEpubProcessor();
        const contentRef = useRef<HTMLDivElement>(null);
        const scrollContainerRef = useRef<HTMLDivElement>(null);
        const [chapterContainer, setChapterContainer] =
            React.useState<HTMLElement | null>(null);
        const hasInitializedChapter = useRef(false);
        const pendingScrollRef = useRef<{
            mode: ScrollLanding;
            target?: string | null;
        } | null>(null);

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

        const {
            loadSingleChapter,
            flatTextBlocks,
            isLoading: chaptersLoading,
            error: chapterLoadError,
            clearError,
            chapters,
            resolveChapterImage,
            commitChapter,
            releaseAll,
        } = useChapterLoader(epubContent, zipData, {
            singleChapterMode: true,
        });

        const [activeChapter, setActiveChapter] =
            React.useState<EpubChapter | null>(null);
        const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
        const [activeHref, setActiveHref] = React.useState<string | null>(null);
        const [restoreBlockId, setRestoreBlockId] = React.useState<
            string | null
        >(null);
        const [failedSpineId, setFailedSpineId] = React.useState<string | null>(
            null
        );

        const chapterOrder = useMemo(
            () => (epubContent ? buildChapterOrder(epubContent) : []),
            [epubContent]
        );

        const {
            activeTextBlockId,
            setActiveTextBlockId,
            isLoading: textBlockIsLoading,
            initialProgress,
        } = useTextBlockNavigation(flatTextBlocks, contentRef, bookId, {
            activeChapterId: activeChapter?.id ?? null,
            restoreBlockId,
        });

        const scrollToLanding = useCallback(
            (mode: ScrollLanding, target?: string | null) => {
                const run = () => {
                    const container = scrollContainerRef.current;
                    if (!container) return;

                    if (mode === "bottom") {
                        container.scrollTo({
                            top: container.scrollHeight,
                            behavior: "auto",
                        });
                        const lastBlock =
                            flatTextBlocks[flatTextBlocks.length - 1];
                        if (lastBlock) {
                            setActiveTextBlockId(lastBlock.id);
                            setRestoreBlockId(lastBlock.id);
                        }
                        return;
                    }

                    if (mode === "block" && target) {
                        const element = document.getElementById(target);
                        if (element) {
                            element.scrollIntoView({
                                behavior: "smooth",
                                block: "center",
                            });
                            setActiveTextBlockId(target);
                            setRestoreBlockId(target);
                            return;
                        }
                    }

                    if (mode === "fragment" && target) {
                        const element = document.getElementById(target);
                        if (element) {
                            element.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                            });
                            return;
                        }
                    }

                    container.scrollTo({ top: 0, behavior: "auto" });
                    const firstBlock = flatTextBlocks[0];
                    if (firstBlock) {
                        setActiveTextBlockId(firstBlock.id);
                        setRestoreBlockId(firstBlock.id);
                    }
                };

                // Wait a frame so the swapped chapter DOM is present.
                requestAnimationFrame(() => {
                    setTimeout(run, 50);
                });
            },
            [flatTextBlocks, setActiveTextBlockId]
        );

        const activateChapter = useCallback(
            (
                chapter: EpubChapter,
                href: string | null,
                landing: ScrollLanding,
                landingTarget?: string | null
            ) => {
                setActiveChapter(chapter);
                setActiveHref(href ?? chapter.hrefId);
                pendingScrollRef.current = {
                    mode: landing,
                    target: landingTarget,
                };
            },
            []
        );

        const loadAndActivateChapter = useCallback(
            async (
                spineId: string,
                href: string | null,
                landing: ScrollLanding,
                landingTarget?: string | null
            ): Promise<boolean> => {
                // Reuse the already-processed document for fragment-only TOC jumps.
                if (activeChapter?.id === spineId) {
                    setFailedSpineId(null);
                    clearError();
                    activateChapter(
                        activeChapter,
                        href,
                        landing,
                        landingTarget
                    );
                    scrollToLanding(landing, landingTarget);
                    return true;
                }

                const chapter = await loadSingleChapter(spineId);
                if (!chapter) {
                    setFailedSpineId(spineId);
                    return false;
                }

                setFailedSpineId(null);
                activateChapter(chapter, href, landing, landingTarget);
                return true;
            },
            [
                activateChapter,
                activeChapter,
                clearError,
                loadSingleChapter,
                scrollToLanding,
            ]
        );

        const handleTocItemClick = useCallback(
            async (hrefId: string) => {
                if (!epubContent) return;

                const spineId = resolveTocHrefToSpineId(epubContent, hrefId);
                if (!spineId) {
                    console.warn(`No spine item for TOC href: ${hrefId}`);
                    return;
                }

                const { fragment } = splitEpubHref(hrefId);
                const ok = await loadAndActivateChapter(
                    spineId,
                    hrefId,
                    fragment ? "fragment" : "top",
                    fragment
                );
                if (!ok) {
                    console.warn(`Failed to load TOC chapter: ${hrefId}`);
                }
            },
            [epubContent, loadAndActivateChapter]
        );

        const canGoPrevious = useMemo(() => {
            if (!activeChapter) return false;
            return (
                getAdjacentChapterId(
                    chapterOrder,
                    activeChapter.id,
                    "previous"
                ) !== null
            );
        }, [activeChapter, chapterOrder]);

        const canGoNext = useMemo(() => {
            if (!activeChapter) return false;
            return (
                getAdjacentChapterId(chapterOrder, activeChapter.id, "next") !==
                null
            );
        }, [activeChapter, chapterOrder]);

        const navigateAdjacentChapter = useCallback(
            async (direction: PullDirection): Promise<boolean> => {
                if (!activeChapter) return false;

                const targetId = getAdjacentChapterId(
                    chapterOrder,
                    activeChapter.id,
                    direction
                );
                if (!targetId) return false;

                return loadAndActivateChapter(
                    targetId,
                    null,
                    direction === "next" ? "top" : "bottom"
                );
            },
            [activeChapter, chapterOrder, loadAndActivateChapter]
        );

        const { pullState, pullLabel, resetPull } = useChapterPullNavigation({
            enabled: isMobile && Boolean(activeChapter),
            scrollContainerRef,
            canGoPrevious,
            canGoNext,
            onCommit: navigateAdjacentChapter,
        });

        const handleChapterContainer = useCallback(
            (element: HTMLElement | null) => {
                setChapterContainer(element);
            },
            []
        );

        useEpubImageHydration({
            enabled: Boolean(activeChapter),
            chapterId: activeChapter?.id ?? null,
            container: chapterContainer,
            scrollRootRef: scrollContainerRef,
            resolveChapterImage,
            onChapterImagesReady: commitChapter,
        });

        useEffect(() => {
            processEpub(url);
        }, [url, processEpub]);

        useEffect(() => {
            hasInitializedChapter.current = false;
            setActiveChapter(null);
            setChapterContainer(null);
            setActiveHref(null);
            setRestoreBlockId(null);
            setFailedSpineId(null);
            releaseAll();
        }, [bookId, releaseAll, url]);

        // Restore progress into a single chapter (mobile and desktop).
        useEffect(() => {
            if (
                !epubContent ||
                !zipData ||
                textBlockIsLoading ||
                hasInitializedChapter.current
            ) {
                return;
            }

            if (chapterOrder.length === 0) return;

            hasInitializedChapter.current = true;

            const progressChapterId = resolveChapterIdFromProgress({
                progressChapter: initialProgress?.progressChapter,
                progressPosition: initialProgress?.progressPosition,
                availableChapterIds: chapterOrder,
            });

            const chapterId = progressChapterId || chapterOrder[0] || null;
            if (!chapterId) return;

            const progressPosition = initialProgress?.progressPosition ?? null;

            (async () => {
                const ok = await loadAndActivateChapter(
                    chapterId,
                    null,
                    progressPosition ? "block" : "top",
                    progressPosition
                );
                if (!ok) {
                    hasInitializedChapter.current = false;
                }
            })();
        }, [
            chapterOrder,
            epubContent,
            initialProgress,
            loadAndActivateChapter,
            textBlockIsLoading,
            zipData,
        ]);

        // Apply pending scroll after a chapter swap renders.
        useEffect(() => {
            if (!activeChapter || !pendingScrollRef.current) return;
            if (chaptersLoading) return;

            const pending = pendingScrollRef.current;
            pendingScrollRef.current = null;
            scrollToLanding(pending.mode, pending.target);
        }, [activeChapter, chaptersLoading, flatTextBlocks, scrollToLanding]);

        // Keep activeChapter in sync when loader atomically replaces it.
        useEffect(() => {
            if (!activeChapter || chapters.length === 0) return;
            const synced = chapters.find(
                (chapter) => chapter.id === activeChapter.id
            );
            if (synced && synced !== activeChapter) {
                setActiveChapter(synced);
            }
        }, [activeChapter, chapters]);

        useEffect(() => {
            if (!chapterLoadError) return;
            resetPull();
        }, [chapterLoadError, resetPull]);

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

        const showInitialSpinner =
            textBlockIsLoading || (!activeChapter && chaptersLoading);

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
                    {isMobile && (
                        <ChapterPullAffordance
                            pullState={pullState}
                            label={
                                pullLabel ??
                                (chapterLoadError
                                    ? "Couldn't load chapter. Pull again to retry."
                                    : null)
                            }
                        />
                    )}
                    <div
                        ref={scrollContainerRef}
                        className="mx-auto max-h-[calc(100%-72px)] max-w-[720px] overflow-y-auto overflow-x-hidden px-5 md:px-10"
                        style={
                            isMobile
                                ? { overscrollBehaviorY: "contain" }
                                : undefined
                        }
                    >
                        <div className="pb-32" ref={contentRef}>
                            {showInitialSpinner || !activeChapter ? (
                                <LoadingSpinner />
                            ) : (
                                <Chapter
                                    activeTextblockId={activeTextBlockId}
                                    chapter={activeChapter}
                                    isLastChapter={!canGoNext}
                                    showNextChapterButton={!isMobile}
                                    onContainerElement={handleChapterContainer}
                                    onAddHighlightContext={
                                        onAddHighlightContext
                                    }
                                    onNextChapter={() => {
                                        void navigateAdjacentChapter("next");
                                    }}
                                    onRetryChapterLoad={
                                        chapterLoadError && failedSpineId
                                            ? () => {
                                                  clearError();
                                                  resetPull();
                                                  void loadAndActivateChapter(
                                                      failedSpineId,
                                                      null,
                                                      "top"
                                                  );
                                              }
                                            : undefined
                                    }
                                    chapterLoadError={chapterLoadError}
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
