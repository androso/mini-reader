import { Bookmark, MessageCircle, Share2 } from "lucide-react";
import React, { memo } from "react";

const extractPlainText = (html: string): string => {
    if (!html) return "";
    if (typeof window === "undefined") {
        return html.replace(/<[^>]*>/g, "").trim();
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent?.trim() || "";
};

const TextBlock = memo(
    ({
        id,
        content,
        isActive,
        onAddHighlightContext,
    }: {
        id: string;
        content: string;
        isActive: boolean;
        onAddHighlightContext?: (text: string) => void;
    }) => {
        const [offset, setOffset] = React.useState(0);
        const [isDragging, setIsDragging] = React.useState(false);
        const [startX, setStartX] = React.useState(0);
        const [isLocked, setIsLocked] = React.useState(false);
        const dragThreshold = 80;

        const getClientX = (e: React.MouseEvent | React.TouchEvent) =>
            "touches" in e ? e.touches[0].clientX : e.clientX;

        const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
            setStartX(getClientX(e));
            if (!isLocked) {
                setIsDragging(true);
            }
        };

        const handleDragMove = (e: React.MouseEvent | React.TouchEvent) => {
            if (!isDragging || isLocked) return;
            const deltaX = getClientX(e) - startX;
            setOffset(Math.min(Math.max(0, deltaX), 100));
        };

        const handleDragEnd = () => {
            setIsDragging(false);
            if (offset > dragThreshold) {
                setOffset(100);
                setIsLocked(true);
            } else {
                setOffset(0);
            }
        };

        const handleUnlock = () => {
            setIsLocked(false);
            setOffset(0);
        };

        const handleParagraphClick = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (isLocked) {
                handleUnlock();
            }
        };

        const renderActionIcons = () => {
            if (!isLocked && offset === 0) return null;
            const opacity = Math.min((offset / dragThreshold) * 1.2, 1);
            const scale = 0.6 + opacity * 0.4;

            return (
                <div className="absolute left-0 top-0 h-full flex flex-col items-center justify-center gap-2 pl-4">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            const text = extractPlainText(content);
                            if (text && onAddHighlightContext) {
                                onAddHighlightContext(text);
                            }
                            handleUnlock();
                        }}
                        className="grid h-11 w-11 place-items-center rounded-[var(--radius-pill)] bg-[var(--color-accent-2-soft)] transition-[background-color,transform,opacity] duration-short hover:bg-[var(--color-paper-3)] active:translate-y-px"
                        style={{ opacity, transform: `scale(${scale})` }}
                        aria-label="Ask about paragraph"
                    >
                        <MessageCircle className="h-5 w-5 text-[var(--color-ink-2)]" />
                    </button>
                    <button
                        type="button"
                        className="grid h-11 w-11 place-items-center rounded-[var(--radius-pill)] bg-[var(--color-accent-2-soft)] transition-[background-color,transform,opacity] duration-short hover:bg-[var(--color-paper-3)]"
                        style={{ opacity, transform: `scale(${scale})` }}
                        aria-label="Bookmark paragraph"
                    >
                        <Bookmark className="h-5 w-5 text-[var(--color-ink-2)]" />
                    </button>
                    <button
                        type="button"
                        className="grid h-11 w-11 place-items-center rounded-[var(--radius-pill)] bg-[var(--color-accent-2-soft)] transition-[background-color,transform,opacity] duration-short hover:bg-[var(--color-paper-3)]"
                        style={{ opacity, transform: `scale(${scale})` }}
                        aria-label="Share paragraph"
                    >
                        <Share2 className="h-5 w-5 text-[var(--color-ink-2)]" />
                    </button>
                </div>
            );
        };

        return (
            <div
                id={id}
                className="ease-hallmark-out relative transform cursor-grab select-none transition-transform duration-short lg:cursor-auto lg:select-text"
            >
                <div
                    className="absolute inset-0 z-10 lg:pointer-events-none"
                    onMouseDown={handleDragStart}
                    onMouseMove={handleDragMove}
                    onMouseUp={handleDragEnd}
                    onMouseLeave={handleDragEnd}
                    onTouchStart={handleDragStart}
                    onTouchMove={(e) => {
                        if (
                            !isDragging &&
                            Math.abs(e.touches[0].clientX - startX) > 10
                        ) {
                            setIsDragging(true);
                            e.preventDefault();
                        }
                        if (isDragging) {
                            e.preventDefault();
                            handleDragMove(e);
                        }
                    }}
                    onTouchEnd={handleDragEnd}
                    style={{
                        touchAction: isDragging ? "none" : "pan-y",
                    }}
                />
                <div className="relative">
                    {renderActionIcons()}
                    <div
                        className={`reader-text-block relative z-10 mb-6 rounded-lg px-4 py-1 ${
                            isActive
                                ? "border-l-2 border-[color-mix(in_oklch,var(--color-accent-2)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-accent-2)_12%,transparent)]"
                                : "border-l-2 border-transparent"
                        } ${isDragging || isLocked ? "shadow-lg" : ""} ${
                            isLocked ? "cursor-pointer" : ""
                        } ${isLocked ? "pointer-events-auto" : "pointer-events-none lg:pointer-events-auto"}`}
                        onClick={handleParagraphClick}
                        style={{
                            transform: `translateX(${offset}px)`,
                            transition: !isDragging
                                ? "transform var(--dur-short) var(--ease-out)"
                                : "none",
                        }}
                        dangerouslySetInnerHTML={{ __html: content }}
                    />
                </div>
            </div>
        );
    }
);

TextBlock.displayName = "TextBlock";
export default TextBlock;
