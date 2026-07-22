import { TextBlock } from "@/types/EpubReader";
import { apiUrl } from "@/lib/api";
import {
    getTextBlockNavigationTarget,
    shouldPersistVisibleTextBlock,
} from "@/lib/readerNavigationBounds";
import React, { useCallback, useEffect, useRef, useState } from "react";

export type ReadingProgress = {
    progressPosition: string | null;
    progressChapter: string | null;
};

export type TextBlockNavigationOptions = {
    /** Spine/manifest chapter ID used when saving progress. */
    activeChapterId?: string | null;
    /**
     * When provided, seeds or re-seeds the active block after a chapter swap
     * (e.g. progress restore, top/bottom landing).
     */
    restoreBlockId?: string | null;
};

export const useTextBlockNavigation = (
    flatTextBlocks: TextBlock[],
    contentRef: React.RefObject<HTMLDivElement | null>,
    bookId: string,
    options: TextBlockNavigationOptions = {}
) => {
    const { activeChapterId = null, restoreBlockId = null } = options;
    const [isLoading, setIsLoading] = useState(true);
    const [activeTextBlockId, setActiveTextBlockId] = useState<string | null>(
        null
    );
    const [initialProgress, setInitialProgress] =
        useState<ReadingProgress | null>(null);
    // manual scroll == navigation using arrow up and down
    const [isManualScroll, setIsManualScroll] = useState(false);
    const scrollTimeout = useRef<NodeJS.Timeout | null>(null);
    const hasFetchedProgress = useRef(false);
    const lastRestoreBlockId = useRef<string | null>(null);

    const fetchProgress = useCallback(async (): Promise<ReadingProgress> => {
        try {
            const response = await fetch(apiUrl(`/api/${bookId}/progress`), {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
                credentials: "include",
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            return {
                progressPosition: data.progressPosition ?? null,
                progressChapter: data.progressChapter ?? null,
            };
        } catch (error) {
            console.error("An error ocurred while progress was fetched", error);
            return {
                progressPosition: null,
                progressChapter: null,
            };
        }
    }, [bookId]);

    const saveProgress = useCallback(
        async (textBlockId: string, chapterId?: string | null) => {
            if (!textBlockId) {
                return;
            }

            const progressChapter =
                chapterId ||
                activeChapterId ||
                // Legacy fallback for callers that have not yet wired chapter IDs.
                textBlockId.replace(/-block-\d+$/, "") ||
                textBlockId;

            try {
                const response = await fetch(
                    apiUrl(`/api/${bookId}/progress`),
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        credentials: "include",
                        body: JSON.stringify({
                            progress_block: textBlockId,
                            progress_chapter: progressChapter,
                        }),
                    }
                );
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
            } catch (error) {
                console.error("Progress cant be saved", error);
            }
        },
        [activeChapterId, bookId]
    );

    // Re-fetch when the book changes so mobile can pick the right chapter first.
    useEffect(() => {
        hasFetchedProgress.current = false;
        lastRestoreBlockId.current = null;
        setInitialProgress(null);
        setActiveTextBlockId(null);
        setIsLoading(true);
    }, [bookId]);

    useEffect(() => {
        if (hasFetchedProgress.current) return;
        hasFetchedProgress.current = true;

        let cancelled = false;
        (async () => {
            const progress = await fetchProgress();
            if (!cancelled) {
                setInitialProgress(progress);
                setIsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [bookId, fetchProgress]);

    // Apply explicit restore targets from chapter navigation.
    useEffect(() => {
        if (!restoreBlockId || restoreBlockId === lastRestoreBlockId.current) {
            return;
        }
        if (flatTextBlocks.some((block) => block.id === restoreBlockId)) {
            lastRestoreBlockId.current = restoreBlockId;
            setActiveTextBlockId(restoreBlockId);
        }
    }, [flatTextBlocks, restoreBlockId]);

    // Seed active block once text blocks are available.
    useEffect(() => {
        if (flatTextBlocks.length === 0) {
            return;
        }

        if (
            activeTextBlockId &&
            flatTextBlocks.some((block) => block.id === activeTextBlockId)
        ) {
            return;
        }

        const storedId = initialProgress?.progressPosition;
        const preferred =
            (storedId &&
                flatTextBlocks.find((block) => block.id === storedId)?.id) ||
            (restoreBlockId &&
                flatTextBlocks.find((block) => block.id === restoreBlockId)
                    ?.id) ||
            flatTextBlocks[0]?.id ||
            null;

        if (preferred) {
            setActiveTextBlockId(preferred);
        }
    }, [activeTextBlockId, flatTextBlocks, initialProgress, restoreBlockId]);

    const getVisibilityRatio = useCallback(
        (element: HTMLElement) => {
            const rect = element.getBoundingClientRect();
            const $parentElement = contentRef.current?.parentElement;
            const parentRect = $parentElement?.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();

            // adjust coordinates of element relative to parent
            const relativeTop = elementRect.top - parentRect!.top;
            const relativeBottom = elementRect.bottom - parentRect!.top;
            const windowHeight = $parentElement!.clientHeight;

            // If element is not in viewport at all
            if (relativeBottom < 0 || relativeTop > windowHeight) {
                return 0;
            }
            if (
                (relativeTop >= 0 && relativeBottom > windowHeight) ||
                (relativeBottom < windowHeight && relativeTop <= 0)
            ) {
                return 0;
            }

            // Calculate the visible height of the element
            const visibleHeight =
                Math.min(rect.bottom, windowHeight) - Math.max(rect.top, 0);
            const ratio = visibleHeight / rect.height;
            return Math.max(0, Math.min(1, ratio));
        },
        [contentRef]
    );

    const findMostVisibleBlock = useCallback(() => {
        if (!flatTextBlocks) return null;
        let maxVisibility = 0;
        let mostVisibleId = null;

        for (const block of flatTextBlocks) {
            const element = document.getElementById(block.id);
            if (element) {
                const visibility = getVisibilityRatio(element);
                if (visibility > maxVisibility) {
                    maxVisibility = visibility;
                    mostVisibleId = block.id;
                }
            }
        }

        return mostVisibleId;
    }, [flatTextBlocks, getVisibilityRatio]);

    const handleScroll = useCallback(() => {
        if (!isManualScroll) {
            if (scrollTimeout.current) {
                clearTimeout(scrollTimeout.current);
            }

            scrollTimeout.current = setTimeout(() => {
                const mostVisibleId = findMostVisibleBlock();
                if (
                    shouldPersistVisibleTextBlock(
                        mostVisibleId,
                        activeTextBlockId
                    )
                ) {
                    setActiveTextBlockId(mostVisibleId);
                    saveProgress(mostVisibleId, activeChapterId);
                }
            }, 300);
        }
    }, [
        activeChapterId,
        activeTextBlockId,
        findMostVisibleBlock,
        isManualScroll,
        saveProgress,
    ]);

    // scroll listener
    useEffect(() => {
        const $container = contentRef.current?.parentElement;
        if (!$container) return;
        $container.addEventListener("scroll", handleScroll);

        return () => {
            $container.removeEventListener("scroll", handleScroll);
            if (scrollTimeout.current) {
                clearTimeout(scrollTimeout.current);
            }
        };
    }, [contentRef, handleScroll]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key == "ArrowDown" || e.key == "ArrowUp") {
                e.preventDefault();
                const targetBlock = getTextBlockNavigationTarget(
                    flatTextBlocks,
                    activeTextBlockId,
                    e.key
                );

                if (targetBlock) {
                    setIsManualScroll(true);
                    setActiveTextBlockId(targetBlock.id);
                    saveProgress(targetBlock.id, activeChapterId);
                    document.getElementById(targetBlock.id)?.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                    });

                    setTimeout(() => {
                        setIsManualScroll(false);
                    }, 300);
                }
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [activeChapterId, activeTextBlockId, flatTextBlocks, saveProgress]);

    return {
        activeTextBlockId,
        setActiveTextBlockId,
        isLoading,
        initialProgress,
        fetchProgress,
        saveProgress,
    };
};
