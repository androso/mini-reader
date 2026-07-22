import { useCallback, useEffect, useRef } from "react";
import JSZip from "jszip";
import {
    normalizeImageMediaType,
    sanitizeEpubSvg,
    type EpubContent,
} from "@reader/epub";
import { ImageObjectUrlRegistry } from "./imageObjectUrlRegistry";

export type ResolveChapterImageOptions = {
    chapterId: string;
    /** Package-relative manifest href stored on data-epub-src */
    manifestHref: string;
    mediaType?: string | null;
    /** Optional inline sanitized SVG payload from data-epub-svg */
    inlineSvg?: string | null;
};

const joinZipPath = (basePath: string, manifestHref: string): string => {
    const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
    const href = manifestHref.replace(/^\/+/, "");
    return `${base}${href}`.replace(/\/{2,}/g, "/");
};

export const useImageLoader = (
    zipData: JSZip | null,
    epubContent: EpubContent | null
) => {
    const pendingLoadsRef = useRef(new Map<string, Promise<string | null>>());
    const chapterCacheRef = useRef(new Map<string, Map<string, string>>());
    const registryRef = useRef<ImageObjectUrlRegistry | null>(null);
    const archiveRef = useRef<{
        zipData: JSZip | null;
        epubContent: EpubContent | null;
        generation: number;
    } | null>(null);
    const activeChapterRef = useRef<string | null>(null);
    const previousChapterRef = useRef<string | null>(null);

    if (!registryRef.current) {
        registryRef.current = new ImageObjectUrlRegistry((url) =>
            URL.revokeObjectURL(url)
        );
    }

    useEffect(() => {
        const registry = registryRef.current!;
        const pendingLoads = pendingLoadsRef.current;
        const chapterCache = chapterCacheRef.current;
        const generation = registry.startArchive();
        archiveRef.current = { zipData, epubContent, generation };
        pendingLoads.clear();
        chapterCache.clear();
        activeChapterRef.current = null;
        previousChapterRef.current = null;

        return () => {
            registry.dispose(generation);
            if (archiveRef.current?.generation === generation) {
                archiveRef.current = null;
                pendingLoads.clear();
                chapterCache.clear();
            }
        };
    }, [zipData, epubContent]);

    const beginChapter = useCallback((chapterId: string) => {
        if (!chapterId) return;
        if (activeChapterRef.current === chapterId) return;
        previousChapterRef.current = activeChapterRef.current;
        activeChapterRef.current = chapterId;
    }, []);

    const commitChapter = useCallback((chapterId: string) => {
        const registry = registryRef.current;
        if (!registry || !chapterId) return;

        activeChapterRef.current = chapterId;
        // Keep only the committed chapter; release the outgoing one and any others.
        registry.retainChapters([chapterId]);

        for (const cachedChapterId of Array.from(
            chapterCacheRef.current.keys()
        )) {
            if (cachedChapterId !== chapterId) {
                chapterCacheRef.current.delete(cachedChapterId);
            }
        }

        previousChapterRef.current = null;
    }, []);

    const releaseAll = useCallback(() => {
        const archive = archiveRef.current;
        const registry = registryRef.current;
        if (!archive || !registry) return;
        registry.dispose(archive.generation);
        const generation = registry.startArchive();
        archiveRef.current = { ...archive, generation };
        pendingLoadsRef.current.clear();
        chapterCacheRef.current.clear();
        activeChapterRef.current = null;
        previousChapterRef.current = null;
    }, []);

    const resolveChapterImage = useCallback(
        async ({
            chapterId,
            manifestHref,
            mediaType,
            inlineSvg,
        }: ResolveChapterImageOptions): Promise<string | null> => {
            const archive = archiveRef.current;
            const registry = registryRef.current;
            if (!archive || !registry || !chapterId) return null;

            const cacheKey = inlineSvg
                ? `inline:${manifestHref || "svg"}:${inlineSvg.length}`
                : manifestHref;
            if (!cacheKey) return null;

            const chapterCache =
                chapterCacheRef.current.get(chapterId) ??
                new Map<string, string>();
            chapterCacheRef.current.set(chapterId, chapterCache);

            const cached = chapterCache.get(cacheKey);
            if (cached) return cached;

            const pendingKey = `${chapterId}::${cacheKey}`;
            const pending = pendingLoadsRef.current.get(pendingKey);
            if (pending) return pending;

            const {
                zipData: activeZip,
                epubContent: activeContent,
                generation,
            } = archive;

            const load = (async (): Promise<string | null> => {
                try {
                    let blob: Blob;

                    if (inlineSvg) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(
                            "<div></div>",
                            "text/html"
                        );
                        const sanitized = sanitizeEpubSvg(inlineSvg, doc);
                        if (!sanitized) return null;
                        blob = new Blob([sanitized], {
                            type: "image/svg+xml",
                        });
                    } else {
                        if (!activeZip || !activeContent) return null;

                        const normalizedType = normalizeImageMediaType(
                            mediaType,
                            manifestHref
                        );
                        if (!normalizedType) return null;

                        const zipPath = joinZipPath(
                            activeContent.basePath,
                            manifestHref
                        );
                        const imageFile =
                            activeZip.file(zipPath) ||
                            activeZip.file(manifestHref);

                        if (!imageFile) {
                            throw new Error(`Image file not found: ${zipPath}`);
                        }

                        if (normalizedType === "image/svg+xml") {
                            const raw = await imageFile.async("text");
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(
                                "<div></div>",
                                "text/html"
                            );
                            const sanitized = sanitizeEpubSvg(raw, doc);
                            if (!sanitized) return null;
                            blob = new Blob([sanitized], {
                                type: "image/svg+xml",
                            });
                        } else {
                            const arrayBuffer =
                                await imageFile.async("arraybuffer");
                            blob = new Blob([arrayBuffer], {
                                type: normalizedType,
                            });
                        }
                    }

                    const url = URL.createObjectURL(blob);
                    if (!registry.register(generation, chapterId, url)) {
                        return null;
                    }

                    // Chapter may have been released while we loaded.
                    if (
                        activeChapterRef.current !== chapterId &&
                        previousChapterRef.current !== chapterId
                    ) {
                        registry.releaseChapter(chapterId);
                        return null;
                    }

                    chapterCache.set(cacheKey, url);
                    return url;
                } catch (error) {
                    console.warn("Failed to resolve EPUB image", error);
                    return null;
                }
            })();

            pendingLoadsRef.current.set(pendingKey, load);
            try {
                return await load;
            } finally {
                if (pendingLoadsRef.current.get(pendingKey) === load) {
                    pendingLoadsRef.current.delete(pendingKey);
                }
            }
        },
        []
    );

    return {
        resolveChapterImage,
        beginChapter,
        commitChapter,
        releaseAll,
    };
};
