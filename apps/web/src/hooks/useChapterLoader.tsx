import { useCallback, useReducer, useEffect } from "react";
import JSZip from "jszip";
import {
    buildTextBlocksFromDocument,
    markChapterImagesForLazyLoad,
    resolveEpubImageResource,
} from "@reader/epub";
import { TextBlock, type EpubContent } from "@/types/EpubReader";
import { useImageLoader } from "@/hooks/useImageLoader";
import { resolveRelativePath } from "@/lib/utils";

export interface Chapter {
    id: string;
    content: string;
    hrefId: string;
    textBlocks: TextBlock[];
}

interface ChapterLoaderState {
    chapters: Chapter[];
    isLoading: boolean;
    error: string | null;
    flatTextBlocks: TextBlock[];
}

type ChapterAction =
    | { type: "START_LOADING" }
    | {
          type: "LOAD_SUCCESS";
          payload: { chapters: Chapter[]; flatTextBlocks: TextBlock[] };
      }
    | { type: "LOAD_ERROR"; payload: string }
    | { type: "CLEAR_ERROR" };

function chapterReducer(
    state: ChapterLoaderState,
    action: ChapterAction
): ChapterLoaderState {
    switch (action.type) {
        case "START_LOADING":
            return {
                ...state,
                isLoading: true,
                error: null,
            };
        case "LOAD_SUCCESS":
            return {
                ...state,
                chapters: action.payload.chapters,
                isLoading: false,
                flatTextBlocks: action.payload.flatTextBlocks,
                error: null,
            };
        case "LOAD_ERROR":
            return {
                ...state,
                error: action.payload,
                isLoading: false,
            };
        case "CLEAR_ERROR":
            return {
                ...state,
                error: null,
            };
    }
}

export type ChapterLoaderOptions = {
    /** When true, only one processed chapter is retained at a time. */
    singleChapterMode?: boolean;
};

export const useChapterLoader = (
    epubContent: EpubContent | null,
    zipData: JSZip | null,
    options: ChapterLoaderOptions = {}
) => {
    const singleChapterMode = Boolean(options.singleChapterMode);
    const { resolveChapterImage, beginChapter, commitChapter, releaseAll } =
        useImageLoader(zipData, epubContent);
    const [state, dispatch] = useReducer(chapterReducer, {
        chapters: [],
        isLoading: false,
        error: null,
        flatTextBlocks: [],
    });

    const loadCssContent = useCallback(
        async (href: string, currentPath?: string): Promise<string | null> => {
            if (!epubContent || !zipData) return null;
            try {
                const basePath = currentPath
                    ? currentPath.substring(0, currentPath.lastIndexOf("/") + 1)
                    : epubContent.basePath;
                const paths = [
                    href,
                    `${basePath}${href}`,
                    resolveRelativePath(href, basePath),
                    `${epubContent.basePath}${href}`,
                    `${epubContent.basePath}styles/${href}`,
                    `${epubContent.basePath}Styles/${href}`,
                    `${epubContent.basePath}css/${href}`,
                    `${epubContent.basePath}CSS/${href}`,
                ].filter(Boolean);

                for (const path of paths) {
                    const cssFile = zipData.file(path);
                    if (cssFile) {
                        const content = await cssFile.async("text");
                        // Process @import statements
                        let processedContent = content;
                        const imports = Array.from(
                            content.matchAll(/@import\s+['"](.*?)['"]/g)
                        );
                        for (const importMatch of imports) {
                            const importedCss = await loadCssContent(
                                importMatch[1],
                                path
                            );
                            processedContent = processedContent.replace(
                                importMatch[0],
                                importedCss || ""
                            );
                        }
                        // Process relative URLs in CSS
                        return processedContent.replace(
                            /url\(['"]?([^'")]+)['"]?\)/g,
                            (match, url) => {
                                if (
                                    url.startsWith("data:") ||
                                    url.startsWith("http")
                                ) {
                                    return match;
                                }
                                const absolutePath = resolveRelativePath(
                                    url,
                                    basePath
                                );
                                return `url('${absolutePath}')`;
                            }
                        );
                    }
                }
            } catch (_err) {
                console.warn("Error loading CSS:", href);
            }
            return null;
        },
        [epubContent, zipData]
    );

    const processHtml = useCallback(
        async (
            html: string,
            chapterId: string,
            chapterHref: string
        ): Promise<TextBlock[]> => {
            if (!epubContent) throw new Error("No EPUB content available");
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            // Process anchor tags to match TOC entries
            Array.from(doc.querySelectorAll("a[href]")).forEach((anchor) => {
                const href = anchor.getAttribute("href");
                const text = anchor.textContent?.trim();
                if (text && epubContent.toc) {
                    const sanitizedHref = href?.split(".")[0];
                    const matchingTocEntry = epubContent.toc.find(
                        (entry) => entry.id === sanitizedHref
                    );
                    if (matchingTocEntry && matchingTocEntry.href) {
                        anchor.setAttribute(
                            "href",
                            `#${matchingTocEntry.href}`
                        );
                    }
                }
            });

            const stylePromises = Array.from(
                doc.querySelectorAll('link[rel="stylesheet"]')
            ).map(async (stylesheet) => {
                const href = stylesheet.getAttribute("href");
                if (href) {
                    const cssContent = await loadCssContent(href);
                    if (cssContent) {
                        const style = doc.createElement("style");
                        style.textContent = cssContent;
                        stylesheet.replaceWith(style);
                    }
                }
            });

            await Promise.all(stylePromises);

            // Mark archive images for lazy hydration; do not unzip image bytes yet.
            markChapterImagesForLazyLoad(doc, (src) =>
                resolveEpubImageResource(epubContent, chapterHref, src)
            );

            doc.querySelectorAll("script").forEach((script) => script.remove());

            return buildTextBlocksFromDocument(doc, chapterId);
        },
        [epubContent, loadCssContent]
    );

    const loadChapter = useCallback(
        async (id: string): Promise<Chapter | null> => {
            if (!epubContent || !zipData) return null;
            try {
                const manifestItem = epubContent.manifest[id];
                if (!manifestItem) {
                    throw new Error(`Manifest item not found for id: ${id}`);
                }

                const fullPath = `${epubContent.basePath}${manifestItem.href}`;
                const file = zipData.file(fullPath);

                if (!file) {
                    throw new Error(`File not found in EPUB: ${fullPath}`);
                }

                const content = await file.async("text");
                const textBlocks = await processHtml(
                    content,
                    id,
                    manifestItem.href
                );

                const newHref = manifestItem.href.includes(".")
                    ? manifestItem.href.substring(
                          0,
                          manifestItem.href.lastIndexOf(".")
                      )
                    : manifestItem.href;

                return {
                    id,
                    content: content,
                    hrefId: newHref,
                    textBlocks,
                };
            } catch (err) {
                console.warn(`Failed to load chapter ${id}:`, err);
                return null;
            }
        },
        [epubContent, zipData, processHtml]
    );

    const loadAllChapters = useCallback(async () => {
        if (singleChapterMode) {
            return;
        }

        if (!epubContent) {
            dispatch({
                type: "LOAD_ERROR",
                payload: "No EPUB content available",
            });
            return;
        }

        if (!state.chapters.length && !state.isLoading) {
            dispatch({ type: "START_LOADING" });
            try {
                const chapterPromises = epubContent.spine.map((id) =>
                    loadChapter(id)
                );
                const loadedChapters = await Promise.all(chapterPromises);
                const validChapters = loadedChapters.filter(
                    (ch): ch is Chapter => ch !== null
                );

                const flatTextBlocks = validChapters.flatMap(
                    (chapter) => chapter.textBlocks
                );

                dispatch({
                    type: "LOAD_SUCCESS",
                    payload: {
                        chapters: validChapters,
                        flatTextBlocks,
                    },
                });
            } catch (err) {
                dispatch({
                    type: "LOAD_ERROR",
                    payload:
                        err instanceof Error
                            ? err.message
                            : "Failed to load chapters",
                });
            }
        }
    }, [
        epubContent,
        loadChapter,
        singleChapterMode,
        state.chapters.length,
        state.isLoading,
    ]);

    /**
     * Process and retain only the requested spine document.
     * Keeps the current chapter visible until the new one is ready, then
     * atomically replaces chapter state. Does not prefetch neighbors.
     */
    const loadSingleChapter = useCallback(
        async (id: string): Promise<Chapter | null> => {
            if (!epubContent) {
                dispatch({
                    type: "LOAD_ERROR",
                    payload: "No EPUB content available",
                });
                return null;
            }

            if (state.chapters.length === 1 && state.chapters[0]?.id === id) {
                dispatch({ type: "CLEAR_ERROR" });
                return state.chapters[0];
            }

            dispatch({ type: "START_LOADING" });
            try {
                beginChapter(id);
                const chapter = await loadChapter(id);
                if (!chapter) {
                    dispatch({
                        type: "LOAD_ERROR",
                        payload: `Failed to load chapter: ${id}`,
                    });
                    return null;
                }

                dispatch({
                    type: "LOAD_SUCCESS",
                    payload: {
                        chapters: [chapter],
                        flatTextBlocks: chapter.textBlocks,
                    },
                });
                return chapter;
            } catch (err) {
                dispatch({
                    type: "LOAD_ERROR",
                    payload:
                        err instanceof Error
                            ? err.message
                            : "Failed to load chapter",
                });
                return null;
            }
        },
        [beginChapter, epubContent, loadChapter, state.chapters]
    );

    const clearError = useCallback(() => {
        dispatch({ type: "CLEAR_ERROR" });
    }, []);

    useEffect(() => {
        // Release image URLs when the book archive changes/unmounts via loader.
        return () => {
            releaseAll();
        };
    }, [releaseAll]);

    return {
        chapters: state.chapters,
        isLoading: state.isLoading,
        error: state.error,
        loadAllChapters,
        loadSingleChapter,
        clearError,
        flatTextBlocks: state.flatTextBlocks,
        singleChapterMode,
        resolveChapterImage,
        beginChapter,
        commitChapter,
        releaseAll,
    };
};
