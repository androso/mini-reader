import React, { useState, memo } from "react";
import { type EpubContent } from "@/types/EpubReader";

interface SidebarProps {
    epubContent: EpubContent;
    isOpen: boolean;
    onClose: () => void;
    onTocItemClick: (href: string) => void;
    activeHref: string | null;
}

const Sidebar: React.FC<SidebarProps> = memo(
    ({ epubContent, isOpen, onClose, onTocItemClick, activeHref }) => {
        const [expandedItems, setExpandedItems] = useState<Set<string>>(
            new Set()
        );

        const hasChildren = (currentIndex: number) => {
            const currentEntry = epubContent.toc[currentIndex];
            return epubContent.toc.some(
                (entry, i) =>
                    i > currentIndex &&
                    entry.level > currentEntry.level &&
                    !epubContent.toc
                        .slice(currentIndex + 1, i)
                        .some((e) => e.level <= currentEntry.level)
            );
        };

        const handleToggle = (index: number) => {
            setExpandedItems((prev) => {
                const next = new Set(prev);
                if (next.has(index.toString())) {
                    next.delete(index.toString());
                } else {
                    next.add(index.toString());
                }
                return next;
            });
        };

        const renderTocItem = (
            entry: (typeof epubContent.toc)[0],
            index: number
        ) => {
            if (!entry) return null;

            const isExpanded = expandedItems.has(index.toString());
            const hasChildrenItems = hasChildren(index);
            const isVisible =
                entry.level === 0 ||
                epubContent.toc
                    .slice(0, index)
                    .some(
                        (prev, i) =>
                            prev.level < entry.level &&
                            expandedItems.has(i.toString()) &&
                            !epubContent.toc
                                .slice(i + 1, index)
                                .some((item) => item.level <= prev.level)
                    );

            if (!isVisible) return null;

            return (
                <div key={`${entry.id}-${index}`}>
                    <div
                        className={`toc-item level-${entry.level} flex cursor-pointer items-center rounded-lg px-3 py-2 transition-colors hover:bg-[#eeeeee] ${entry.href === activeHref ? "bg-[#e2e1f1] text-[#1a1b26]" : "text-[#47464c]"}`}
                        style={{
                            paddingLeft: `${entry.level * 1.5}rem`,
                        }}
                        onClick={() => {
                            onTocItemClick(entry.href!);
                            onClose();
                        }}
                    >
                        {hasChildrenItems && (
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleToggle(index);
                                }}
                                className="mr-1 cursor-pointer border-none bg-transparent p-1 text-[#616363]"
                            >
                                {isExpanded ? "▼" : "▶"}
                            </button>
                        )}
                        <a
                            href={`#${entry.href}`}
                            className="flex-1 py-1 no-underline"
                            onClick={(e) => {
                                if (hasChildrenItems) {
                                    e.preventDefault();
                                }
                            }}
                        >
                            {entry.title}
                        </a>
                    </div>
                </div>
            );
        };

        return (
            <div
                className={`absolute left-0 z-30 h-full overflow-x-hidden border-r border-[#c8c5cc] bg-white shadow-lg transition-transform duration-300 ease-in-out ${
                    isOpen ? "translate-x-0" : "-translate-x-full"
                }`}
            >
                <div className="h-full w-72 p-5 pt-[5rem]">
                    <div className="">
                        <h3 className="font-sans text-lg font-semibold leading-tight text-[#1a1c1c]">
                            {epubContent.metadata.title}
                        </h3>
                        <p className="mb-4 mt-2 font-serif text-sm italic text-[#616363]">
                            {epubContent.metadata.creator}
                        </p>
                    </div>
                    <div className="overflow-y-auto h-[calc(100%-7rem)]">
                        <nav className="flex flex-col">
                            {epubContent.toc.map((entry, index) =>
                                renderTocItem(entry, index)
                            )}
                        </nav>
                    </div>
                </div>
            </div>
        );
    }
);

export default Sidebar;
