import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { EPUB_IMAGE_MARKER_ATTRIBUTE } from "@reader/epub";
import type { ResolveChapterImageOptions } from "@/hooks/useImageLoader";
import {
    EPUB_IMAGE_ROOT_MARGIN_PX,
    isNearScrollRoot,
} from "@/hooks/epubImageVisibility";

type ResolveChapterImage = (
    options: ResolveChapterImageOptions
) => Promise<string | null>;

const MARKER_SRC = EPUB_IMAGE_MARKER_ATTRIBUTE.src;
const MARKER_MIME = EPUB_IMAGE_MARKER_ATTRIBUTE.mime;
const MARKER_SVG = EPUB_IMAGE_MARKER_ATTRIBUTE.svg;

const UNAVAILABLE_LABEL = "Image unavailable";

const markUnavailable = (img: HTMLImageElement) => {
    img.removeAttribute("src");
    img.setAttribute("alt", img.getAttribute("alt") || UNAVAILABLE_LABEL);
    img.setAttribute("data-epub-failed", "true");
    img.classList.add("epub-image-unavailable");
};

/**
 * Lazily hydrate marked EPUB images inside a chapter container.
 * Rooted at the reader scroll container with a 600px margin.
 *
 * `container` must be the live mounted element (React state), not only a
 * ref. Chapter mount happens after the active chapter is set, so a
 * ref-only read races and never hydrates cover/standalone images.
 */
export const useEpubImageHydration = ({
    enabled,
    chapterId,
    container,
    scrollRootRef,
    resolveChapterImage,
    onChapterImagesReady,
}: {
    enabled: boolean;
    chapterId: string | null;
    container: HTMLElement | null;
    scrollRootRef: RefObject<HTMLElement | null>;
    resolveChapterImage: ResolveChapterImage;
    /** Called after the chapter commits and observers are attached. */
    onChapterImagesReady?: (chapterId: string) => void;
}) => {
    const resolveRef = useRef(resolveChapterImage);
    resolveRef.current = resolveChapterImage;
    const readyRef = useRef(onChapterImagesReady);
    readyRef.current = onChapterImagesReady;
    const hydratedRef = useRef(new WeakSet<Element>());
    const inFlightRef = useRef(new WeakSet<Element>());

    useEffect(() => {
        if (!enabled || !chapterId || !container) return;

        let cancelled = false;

        const hydrate = async (img: HTMLImageElement) => {
            if (hydratedRef.current.has(img) || inFlightRef.current.has(img)) {
                return;
            }
            inFlightRef.current.add(img);

            const manifestHref = img.getAttribute(MARKER_SRC);
            const inlineSvg = img.getAttribute(MARKER_SVG);
            const mediaType = img.getAttribute(MARKER_MIME);

            if (!manifestHref && !inlineSvg) {
                markUnavailable(img);
                inFlightRef.current.delete(img);
                return;
            }

            try {
                const url = await resolveRef.current({
                    chapterId,
                    manifestHref: manifestHref || "inline-svg",
                    mediaType,
                    inlineSvg,
                });

                // Chapter may have swapped before completion; chapter release
                // owns URL revocation for the previous scope.
                if (cancelled || !container.contains(img)) {
                    return;
                }

                if (!url) {
                    markUnavailable(img);
                    return;
                }

                await new Promise<void>((resolve) => {
                    const handleLoad = () => {
                        cleanup();
                        resolve();
                    };
                    const handleError = () => {
                        cleanup();
                        markUnavailable(img);
                        resolve();
                    };
                    const cleanup = () => {
                        img.removeEventListener("load", handleLoad);
                        img.removeEventListener("error", handleError);
                    };

                    img.addEventListener("load", handleLoad);
                    img.addEventListener("error", handleError);
                    img.src = url;
                    img.setAttribute("loading", "lazy");
                    img.setAttribute("decoding", "async");
                    // Clear inline payload after hydration to free DOM attribute memory.
                    img.removeAttribute(MARKER_SVG);
                });

                hydratedRef.current.add(img);
            } catch {
                if (!cancelled && container.contains(img)) markUnavailable(img);
            } finally {
                inFlightRef.current.delete(img);
            }
        };

        const images = Array.from(
            container.querySelectorAll<HTMLImageElement>(
                `img[${MARKER_SRC}], img[${MARKER_SVG}]`
            )
        );

        // Data-URL images already have src; ensure lazy attrs exist.
        container
            .querySelectorAll<HTMLImageElement>("img[src^='data:image']")
            .forEach((img) => {
                img.setAttribute("loading", "lazy");
                img.setAttribute("decoding", "async");
            });

        if (images.length === 0) {
            readyRef.current?.(chapterId);
            return;
        }

        const scrollRoot = scrollRootRef.current;
        const observer =
            typeof IntersectionObserver !== "undefined"
                ? new IntersectionObserver(
                      (entries) => {
                          for (const entry of entries) {
                              if (!entry.isIntersecting) continue;
                              const img = entry.target as HTMLImageElement;
                              observer?.unobserve(img);
                              void hydrate(img);
                          }
                      },
                      {
                          root: scrollRoot,
                          rootMargin: `${EPUB_IMAGE_ROOT_MARGIN_PX}px 0px`,
                          // 0-area placeholders (cover imgs before src) must still
                          // count as intersecting once they enter the root.
                          threshold: 0,
                      }
                  )
                : null;

        for (const img of images) {
            if (cancelled) break;
            // Eager-hydrate when IO cannot be trusted to deliver the first
            // callback across chapter remounts: zero-box placeholders, already
            // near the scroll root, or no IntersectionObserver support.
            if (!observer || isNearScrollRoot(img, scrollRoot)) {
                void hydrate(img);
                continue;
            }
            observer.observe(img);
        }

        readyRef.current?.(chapterId);

        return () => {
            cancelled = true;
            observer?.disconnect();
        };
    }, [chapterId, container, enabled, scrollRootRef]);
};
