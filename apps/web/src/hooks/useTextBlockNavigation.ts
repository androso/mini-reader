import { TextBlock } from "@/types/EpubReader";
import { apiUrl } from "@/lib/api";
import React, { useCallback, useEffect, useRef, useState } from "react";

export const useTextBlockNavigation = (
    flatTextBlocks: TextBlock[],
    contentRef: React.RefObject<HTMLDivElement | null>,
    bookId: string
) => {
    const [isLoading, setIsLoading] = useState(true);
    const [activeTextBlockId, setActiveTextBlockId] = useState<string | null>(
        null
    );
    // manual scroll == navigation using arrow up and down
    const [isManualScroll, setIsManualScroll] = useState(false);
    const scrollTimeout = useRef<NodeJS.Timeout | null>(null);

    const fetchProgress = useCallback(async () => {
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

            // Handle null progressPosition
            if (!data.progressPosition) {
                return null;
            }

            return data.progressPosition;
        } catch (error) {
            console.error("An error ocurred while progress was fetched", error);
            return null;
        }
    }, [bookId]);

    //save progress
    const saveProgress = useCallback(
        async (textBlockId: string) => {
            if (!textBlockId) {
                return;
            }
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
                            progress_chapter: textBlockId.split("-")[0], // assuming format like "c01-block-16"
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
        [bookId]
    );

    useEffect(() => {
        if (!activeTextBlockId && flatTextBlocks.length > 0) {
            const initializeProgress = async () => {
                try {
                    const storedId = await fetchProgress();
                    setActiveTextBlockId(storedId || flatTextBlocks[0].id);
                    const element = document.getElementById(
                        storedId || flatTextBlocks[0].id
                    );
                    if (element) {
                        element.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                        });
                    }
                } finally {
                    setIsLoading(false);
                }
            };
            //this retrieves the progress from the server
            initializeProgress();
        }
    }, [activeTextBlockId, fetchProgress, flatTextBlocks]);

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
                if (mostVisibleId) {
                    saveProgress(mostVisibleId);
                    if (mostVisibleId !== activeTextBlockId) {
                        setActiveTextBlockId(mostVisibleId);
                    }
                }
            }, 300);
        }
    }, [activeTextBlockId, findMostVisibleBlock, isManualScroll, saveProgress]);

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
                setIsManualScroll(true);

                const currTextBlockIndex = flatTextBlocks.findIndex(
                    (block) => block.id === activeTextBlockId
                );

                const newIndex =
                    e.key === "ArrowDown"
                        ? Math.min(
                              currTextBlockIndex + 1,
                              flatTextBlocks.length
                          )
                        : Math.max(currTextBlockIndex - 1, 0);

                if (newIndex !== currTextBlockIndex) {
                    const targetBlock = flatTextBlocks[newIndex];
                    setActiveTextBlockId(targetBlock.id);
                    saveProgress(targetBlock.id);
                    document.getElementById(targetBlock.id)?.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                    });
                }

                setTimeout(() => {
                    setIsManualScroll(false);
                }, 300);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [activeTextBlockId, flatTextBlocks, saveProgress]);

    return {
        activeTextBlockId,
        isLoading,
    };
};
