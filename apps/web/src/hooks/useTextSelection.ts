import { useEffect, useRef, useState } from "react";

const useTextSelection = (tooltipContent: string = "hello") => {
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const [isVisible, setIsVisible] = useState(false);
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const expandSelectionToWord = () => {
            const sel = window.getSelection();
            if (!sel?.rangeCount) return;

            const range = sel.getRangeAt(0);
            const start = range.startContainer;
            const end = range.endContainer;

            // Only expand if there's an actual selection (not just a click)
            if (range.startOffset === range.endOffset) return;

            // Only process text nodes
            if (
                start.nodeType === Node.TEXT_NODE &&
                end.nodeType === Node.TEXT_NODE
            ) {
                const startText = start.textContent || "";
                const endText = end.textContent || "";

                // Find word boundaries
                let startOffset = range.startOffset;
                while (
                    startOffset > 0 &&
                    /\S/.test(startText[startOffset - 1])
                ) {
                    startOffset--;
                }

                let endOffset = range.endOffset;
                while (
                    endOffset < endText.length &&
                    /\S/.test(endText[endOffset])
                ) {
                    endOffset++;
                }

                // Update the range
                range.setStart(start, startOffset);
                range.setEnd(end, endOffset);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        };

        const handleSelectionChange = () => {
            const selection = window.getSelection();
            if (selection?.toString().length) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                // Calculate position considering viewport bounds
                const viewportWidth = window.innerWidth;
                const tooltipWidth = tooltipRef.current?.offsetWidth || 0;
                const leftPosition = Math.min(
                    rect.right,
                    viewportWidth - tooltipWidth - 20
                );

                setTooltipPosition({
                    x: leftPosition,
                    y:
                        rect.top -
                        (tooltipRef.current?.offsetHeight || 0) -
                        10 +
                        window.scrollY,
                });
                setIsVisible(true);
            } else {
                setIsVisible(false);
            }
        };

        document.addEventListener("mouseup", expandSelectionToWord);
        document.addEventListener("selectionchange", handleSelectionChange);

        return () => {
            document.removeEventListener("mouseup", expandSelectionToWord);
            document.removeEventListener(
                "selectionchange",
                handleSelectionChange
            );
        };
    }, []);

    return { tooltipRef, tooltipPosition, isVisible };
};
