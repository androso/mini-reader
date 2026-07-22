import { resolveTocHrefToSpineId } from "./navigation";
import type { EpubContent } from "./types";

/**
 * Build the reading order as unique spine document IDs.
 * Prefers resolvable TOC entries (first occurrence wins per spine file).
 * Falls back to spine order when the TOC is absent or unusable.
 */
export const buildChapterOrder = (epubContent: EpubContent): string[] => {
    const order: string[] = [];
    const seen = new Set<string>();

    for (const entry of epubContent.toc ?? []) {
        const spineId = resolveTocHrefToSpineId(epubContent, entry.href);
        if (!spineId || seen.has(spineId)) continue;
        seen.add(spineId);
        order.push(spineId);
    }

    if (order.length === 0) {
        return [...epubContent.spine];
    }

    return order;
};

export const getAdjacentChapterId = (
    order: string[],
    activeChapterId: string | null | undefined,
    direction: "previous" | "next"
): string | null => {
    if (!activeChapterId || order.length === 0) return null;

    const index = order.indexOf(activeChapterId);
    if (index < 0) return null;

    const targetIndex = direction === "next" ? index + 1 : index - 1;
    if (targetIndex < 0 || targetIndex >= order.length) return null;

    return order[targetIndex] ?? null;
};

/** @deprecated Prefer buildChapterOrder; retained for existing imports. */
export const buildMobileChapterOrder = buildChapterOrder;
