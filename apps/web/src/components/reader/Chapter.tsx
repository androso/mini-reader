import { memo } from "react";
import TextBlock from "./TextBlock";
import {
    type ChapterBlock,
    type TextBlock as TextBlockType,
} from "@/types/EpubReader";

const Chapter = memo(
    ({
        chapter,
        activeTextblockId,
        onNextChapter,
        isLastChapter,
        onAddHighlightContext,
    }: {
        chapter: ChapterBlock;
        activeTextblockId: string | null;
        onNextChapter: () => void;
        isLastChapter: boolean;
        onAddHighlightContext?: (text: string) => void;
    }) => (
        <div id={chapter.hrefId}>
            {chapter.textBlocks.map((textBlock: TextBlockType) => (
                <TextBlock
                    key={textBlock.id}
                    id={textBlock.id}
                    content={textBlock.content}
                    isActive={activeTextblockId === textBlock.id}
                    onAddHighlightContext={onAddHighlightContext}
                />
            ))}
            {!isLastChapter && (
                <div className="flex justify-center py-8">
                    <button
                        onClick={onNextChapter}
                        className="grid h-12 w-12 place-items-center rounded-[var(--radius-pill)] bg-[var(--color-accent)] text-[var(--color-accent-ink)] transition-[background-color,transform] duration-short hover:bg-[var(--color-accent-deep)] active:translate-y-px"
                        aria-label="Next chapter"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M7 13l5 5 5-5" />
                            <path d="M7 6l5 5 5-5" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    )
);

Chapter.displayName = "Chapter";
export default Chapter;
