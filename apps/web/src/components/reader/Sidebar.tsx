import React, { useState, memo } from "react";
import { type EpubContent } from "@/types/EpubReader";
import { ChevronDown, ChevronRight } from "lucide-react";

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
                        className={`toc-item level-${entry.level} flex min-h-11 cursor-pointer items-center rounded-[var(--radius-input)] py-2 pr-3 transition-colors hover:bg-[var(--color-paper-2)] ${entry.href === activeHref ? "bg-[var(--color-accent-2-soft)] text-[var(--color-ink)]" : "text-[var(--color-ink-2)]"}`}
                        style={{
                            paddingInlineStart: `calc(var(--space-lg) * ${entry.level + 1})`,
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
                                className="mr-1 grid h-8 w-8 cursor-pointer place-items-center rounded-[var(--radius-pill)] border-none bg-transparent text-[var(--color-ink-2)]"
                                aria-label={
                                    isExpanded
                                        ? "Collapse section"
                                        : "Expand section"
                                }
                            >
                                {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                ) : (
                                    <ChevronRight className="h-4 w-4" />
                                )}
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
                className={`ease-hallmark-in-out absolute left-0 z-[var(--z-dropdown)] h-full overflow-x-hidden border-r border-[var(--color-rule)] bg-[var(--color-paper-raised)] transition-transform duration-long ${
                    isOpen ? "translate-x-0" : "-translate-x-full"
                }`}
            >
                <div className="h-full w-72 p-5 pt-[5rem]">
                    <div className="">
                        <h3 className="font-sans text-lg font-semibold leading-tight text-[var(--color-ink)]">
                            {epubContent.metadata.title}
                        </h3>
                        <p className="mb-4 mt-2 font-serif text-sm italic text-[var(--color-ink-2)]">
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

Sidebar.displayName = "Sidebar";

export default Sidebar;
