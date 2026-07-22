const BLOCK_ID_PATTERN = /^(.*)-block-\d+$/;

/**
 * Recover a chapter ID from a text-block progress position.
 * Supports chapter IDs that themselves contain hyphens
 * (e.g. "chapter-1-block-3" → "chapter-1").
 */
export const chapterIdFromProgressPosition = (
    progressPosition: string | null | undefined
): string | null => {
    if (!progressPosition) return null;
    const match = progressPosition.match(BLOCK_ID_PATTERN);
    const chapterId = match?.[1]?.trim();
    return chapterId ? chapterId : null;
};

export type ResolveProgressChapterArgs = {
    progressChapter?: string | null;
    progressPosition?: string | null;
    availableChapterIds: Iterable<string>;
};

/**
 * Prefer the saved progress chapter when it matches an available ID.
 * Otherwise recover from the `-block-N` suffix so legacy values that
 * used `split("-")[0]` still restore correctly for hyphenated IDs.
 */
export const resolveChapterIdFromProgress = ({
    progressChapter,
    progressPosition,
    availableChapterIds,
}: ResolveProgressChapterArgs): string | null => {
    const available = new Set(
        [...availableChapterIds].filter((id) => id.trim().length > 0)
    );
    if (available.size === 0) return null;

    if (progressChapter && available.has(progressChapter)) {
        return progressChapter;
    }

    const fromPosition = chapterIdFromProgressPosition(progressPosition);
    if (fromPosition && available.has(fromPosition)) {
        return fromPosition;
    }

    return null;
};
