export type ChapterLike = {
    id: string;
};

export type TextBlockLike = {
    id: string;
};

export const getNextChapter = <TChapter extends ChapterLike>(
    chapters: TChapter[],
    activeChapter: ChapterLike | null
): TChapter | null => {
    if (!activeChapter) return null;

    const activeChapterIndex = chapters.findIndex(
        (chapter) => chapter.id === activeChapter.id
    );
    if (activeChapterIndex < 0 || activeChapterIndex >= chapters.length - 1) {
        return null;
    }

    return chapters[activeChapterIndex + 1] ?? null;
};

export const getPreviousChapter = <TChapter extends ChapterLike>(
    chapters: TChapter[],
    activeChapter: ChapterLike | null
): TChapter | null => {
    if (!activeChapter) return null;

    const activeChapterIndex = chapters.findIndex(
        (chapter) => chapter.id === activeChapter.id
    );
    if (activeChapterIndex <= 0) {
        return null;
    }

    return chapters[activeChapterIndex - 1] ?? null;
};

export const isLastChapter = (
    chapters: ChapterLike[],
    activeChapter: ChapterLike | null
) => getNextChapter(chapters, activeChapter) === null;

export const isFirstChapter = (
    chapters: ChapterLike[],
    activeChapter: ChapterLike | null
) => getPreviousChapter(chapters, activeChapter) === null;

export const getTextBlockNavigationTarget = <TTextBlock extends TextBlockLike>(
    flatTextBlocks: TTextBlock[],
    activeTextBlockId: string | null,
    key: "ArrowDown" | "ArrowUp"
): TTextBlock | null => {
    if (flatTextBlocks.length === 0) return null;

    const currentIndex = flatTextBlocks.findIndex(
        (block) => block.id === activeTextBlockId
    );
    if (currentIndex < 0) return flatTextBlocks[0] ?? null;

    const targetIndex =
        key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1;
    if (targetIndex < 0 || targetIndex >= flatTextBlocks.length) return null;

    return flatTextBlocks[targetIndex] ?? null;
};

export const shouldPersistVisibleTextBlock = (
    visibleTextBlockId: string | null,
    activeTextBlockId: string | null
): visibleTextBlockId is string =>
    Boolean(visibleTextBlockId && visibleTextBlockId !== activeTextBlockId);
