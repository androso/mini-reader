/** Shared margin for IntersectionObserver and eager near-root checks. */
export const EPUB_IMAGE_ROOT_MARGIN_PX = 600;

/**
 * True when the image already intersects the scroll root expanded by
 * EPUB_IMAGE_ROOT_MARGIN_PX. Used to eager-hydrate without waiting on IO,
 * because chapter swaps can disconnect observers before the first callback.
 */
export const isNearScrollRoot = (
    img: Element,
    root: Element | null,
    marginPx: number = EPUB_IMAGE_ROOT_MARGIN_PX
): boolean => {
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return true;

    const rootRect = root
        ? root.getBoundingClientRect()
        : {
              top: 0,
              bottom: typeof window !== "undefined" ? window.innerHeight : 0,
              left: 0,
              right: typeof window !== "undefined" ? window.innerWidth : 0,
          };

    return !(
        rect.bottom < rootRect.top - marginPx ||
        rect.top > rootRect.bottom + marginPx ||
        rect.right < rootRect.left - marginPx ||
        rect.left > rootRect.right + marginPx
    );
};
