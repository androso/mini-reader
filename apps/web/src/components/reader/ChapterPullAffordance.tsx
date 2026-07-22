import { memo } from "react";
import type { PullGestureState } from "@/lib/chapterPullGesture";

type ChapterPullAffordanceProps = {
    pullState: PullGestureState;
    label: string | null;
};

const ChapterPullAffordance = memo(
    ({ pullState, label }: ChapterPullAffordanceProps) => {
        const isError = pullState.phase === "error";
        if (!label) return null;
        if (!isError && (pullState.displacement <= 0 || !pullState.direction)) {
            return null;
        }

        const isTop = pullState.direction !== "next";
        const opacity = isError
            ? 1
            : Math.min(0.35 + pullState.displacement / 96, 0.95);
        const offset = Math.min(pullState.displacement, 96);

        return (
            <div
                aria-live="polite"
                className={`pointer-events-none absolute inset-x-0 z-[var(--z-raised)] flex justify-center px-4 ${
                    isTop ? "top-[72px]" : "bottom-4"
                }`}
                style={{
                    transform: isTop
                        ? `translateY(${offset * 0.35}px)`
                        : `translateY(-${offset * 0.35}px)`,
                    opacity,
                }}
            >
                <div
                    className={`rounded-[var(--radius-pill)] px-4 py-2 text-center text-sm font-medium shadow-sm ${
                        isError
                            ? "bg-[var(--color-accent-3-soft)] text-[var(--color-accent-3)]"
                            : pullState.phase === "armed"
                              ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
                              : "bg-[var(--color-paper-2)] text-[var(--color-ink-2)]"
                    }`}
                >
                    {label}
                </div>
            </div>
        );
    }
);

ChapterPullAffordance.displayName = "ChapterPullAffordance";

export default ChapterPullAffordance;
