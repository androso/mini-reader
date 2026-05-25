import React, { useEffect, useRef, memo } from "react";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import { useEpubProcessor } from "@/hooks/useEpubProcessor";
import { useChapterLoader } from "@/hooks/useChapterLoader";
import { useTextBlockNavigation } from "@/hooks/useTextBlockNavigation";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import Chapter from "./Chapter";
import type { Chapter as EpubChapter } from "@/hooks/useChapterLoader";
import { findChapterByHref } from "@/lib/epubNavigation";

interface EpubReaderProps {
    url: string;
}

const EpubReader: React.FC<EpubReaderProps> = memo(({ url }) => {
    const { processEpub, isLoading, error, epubContent, zipData } =
        useEpubProcessor();
    const contentRef = useRef<HTMLDivElement>(null);
    const { chapters, loadAllChapters, flatTextBlocks } = useChapterLoader(
        epubContent,
        zipData
    );
    const [activeChapter, setActiveChapter] =
        React.useState<EpubChapter | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
    const [activeHref, setActiveHref] = React.useState<string | null>(null);
    const { activeTextBlockId, isLoading: textBlockIsLoading } =
        useTextBlockNavigation(flatTextBlocks, contentRef);

    const handleTocItemClick = (hrefId: string) => {
        const targetChapter = findChapterByHref(chapters, hrefId);
        if (!targetChapter) {
            console.warn(`No chapter found for TOC href: ${hrefId}`);
            return;
        }

        setActiveChapter(targetChapter);
        setActiveHref(hrefId);
        setTimeout(() => {
            contentRef.current?.parentElement?.scrollTo({
                top: 0,
                behavior: "smooth",
            });
        }, 100);
    };

    useEffect(() => {
        processEpub(url);
    }, [url, processEpub]);

    useEffect(() => {
        if (epubContent && zipData) {
            loadAllChapters();
        }
    }, [epubContent, zipData, loadAllChapters]);

    // Set initial activeHref based on activeTextBlockId
    useEffect(() => {
        if (!textBlockIsLoading && activeTextBlockId && chapters.length > 0) {
            const chapterId = activeTextBlockId.split("-")[0];
            const chapter = chapters.find(
                (c) => c.hrefId.includes(chapterId) || c.id.includes(chapterId)
            );
            if (chapter && !activeHref) {
                setActiveChapter(chapter);
                setActiveHref(chapter.hrefId);
                // Give time for the chapter to render before scrolling
                setTimeout(() => {
                    const element = document.getElementById(activeTextBlockId);
                    if (element) {
                        element.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                        });
                    }
                }, 100);
            }
        }
    }, [textBlockIsLoading, activeTextBlockId, chapters]);

    if (isLoading) {
        return (
            <div className="loading-spinner">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-t-blue-500 border-r-blue-500 border-b-transparent border-l-transparent" />
                <div className="mt-4 text-lg text-gray-600">
                    Loading book...
                </div>
            </div>
        );
    }

    if (error) {
        return <div className="p-4 text-red-600">{error}</div>;
    }

    if (!epubContent || !zipData) {
        return null;
    }

    return (
        <>
            <Sidebar
                epubContent={epubContent}
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onTocItemClick={handleTocItemClick}
                activeHref={activeHref}
            />

            <div className="relative h-full overflow-x-hidden bg-[#f9f9f9]">
                <div className="sticky left-0 right-0 top-0 z-50 flex h-[72px] items-center bg-[#f9f9f9] px-6 md:px-10">
                    <button
                        className="z-40 cursor-pointer rounded-lg border-none bg-transparent p-2 text-[#47464c] opacity-80 transition-colors duration-200 hover:bg-[#eeeeee] hover:text-[#1f202b]"
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    >
                        <Menu className="h-6 w-6" />
                    </button>
                </div>
                <div className="mx-auto max-h-[calc(100%-72px)] max-w-[720px] overflow-y-auto overflow-x-hidden px-5 md:px-10">
                    <div className="pb-32" ref={contentRef}>
                        {isLoading || textBlockIsLoading || !activeChapter ? (
                            <LoadingSpinner />
                        ) : (
                            <Chapter
                                activeTextblockId={activeTextBlockId}
                                chapter={activeChapter}
                                isLastChapter={false}
                                onNextChapter={() => {
                                    const nextChapter = chapters.findIndex(
                                        (ch) => ch.id === activeChapter.id
                                    );
                                    setActiveChapter(chapters[nextChapter + 1]);
                                    setTimeout(() => {
                                        contentRef.current?.scrollIntoView({
                                            behavior: "smooth",
                                        });
                                    }, 100);
                                }}
                            />
                        )}
                    </div>
                </div>
            </div>
        </>
    );
});

EpubReader.displayName = "EpubReader";

export default EpubReader;
