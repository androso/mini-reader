import { Bookmark, MessageCircle, Share2 } from "lucide-react";
import React, { memo } from "react";

const TextBlock = memo(
    ({
        id,
        content,
        isActive,
    }: {
        id: string;
        content: string;
        isActive: boolean;
    }) => {
        const [offset, setOffset] = React.useState(0);
        const [isDragging, setIsDragging] = React.useState(false);
        const [startX, setStartX] = React.useState(0);
        const [isLocked, setIsLocked] = React.useState(false);
        const dragThreshold = 80;

        const handleDragMove = (e: React.TouchEvent) => {
            if (!isDragging || isLocked) return;
            const clientX = e.touches[0].clientX;
            const deltaX = clientX - startX;
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
                        className="rounded-full bg-[#e2e1f1] p-2 transition-all hover:bg-[#c6c5d4]"
                        style={{ opacity, transform: `scale(${scale})` }}
                    >
                        <MessageCircle className="h-5 w-5 text-[#454652]" />
                    </button>
                    <button
                        className="rounded-full bg-[#e2e1f1] p-2 transition-all hover:bg-[#c6c5d4]"
                        style={{ opacity, transform: `scale(${scale})` }}
                    >
                        <Bookmark className="h-5 w-5 text-[#454652]" />
                    </button>
                    <button
                        className="rounded-full bg-[#e2e1f1] p-2 transition-all hover:bg-[#c6c5d4]"
                        style={{ opacity, transform: `scale(${scale})` }}
                    >
                        <Share2 className="h-5 w-5 text-[#454652]" />
                    </button>
                </div>
            );
        };

        return (
            <div
                id={id}
                className="relative transform cursor-grab select-none transition-all md:cursor-auto md:select-text"
            >
                <div
                    className="absolute inset-0 z-10 md:pointer-events-none"
                    onTouchStart={(e) => {
                        const touch = e.touches[0];
                        setStartX(touch.clientX);
                    }}
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
                                ? "border-l-4 border-[#5d5d6b] bg-[#eeeeee]"
                                : "border-l-4 border-transparent"
                        } ${isDragging || isLocked ? "shadow-lg" : ""} ${
                            isLocked ? "cursor-pointer" : ""
                        } ${isLocked ? "pointer-events-auto" : "pointer-events-none md:pointer-events-auto"}`}
                        onClick={handleParagraphClick}
                        style={{
                            transform: `translateX(${offset}px)`,
                            transition: !isDragging
                                ? "transform 0.2s ease-out"
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
