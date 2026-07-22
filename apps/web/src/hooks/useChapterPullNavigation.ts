import {
    applyPullEnd,
    applyPullMove,
    getPullAffordanceLabel,
    INITIAL_PULL_GESTURE_STATE,
    resetPullGesture,
    setPullError,
    type PullDirection,
    type PullGestureState,
} from "@/lib/chapterPullGesture";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from "react";

const SCROLL_EDGE_EPSILON_PX = 1;

export type ChapterPullNavigationArgs = {
    enabled: boolean;
    scrollContainerRef: RefObject<HTMLElement | null>;
    canGoPrevious: boolean;
    canGoNext: boolean;
    onCommit: (direction: PullDirection) => Promise<boolean>;
};

export const useChapterPullNavigation = ({
    enabled,
    scrollContainerRef,
    canGoPrevious,
    canGoNext,
    onCommit,
}: ChapterPullNavigationArgs) => {
    const [pullState, setPullState] = useState<PullGestureState>(
        INITIAL_PULL_GESTURE_STATE
    );
    const [suppressBrowserRefresh, setSuppressBrowserRefresh] = useState(false);
    const pullStateRef = useRef(pullState);
    const touchStartY = useRef<number | null>(null);
    const committingRef = useRef(false);

    useEffect(() => {
        pullStateRef.current = pullState;
    }, [pullState]);

    const getScrollMetrics = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) {
            return { atTop: false, atBottom: false };
        }

        const { scrollTop, clientHeight, scrollHeight } = container;
        const atTop = scrollTop <= SCROLL_EDGE_EPSILON_PX;
        const atBottom =
            scrollTop + clientHeight >= scrollHeight - SCROLL_EDGE_EPSILON_PX;
        return { atTop, atBottom };
    }, [scrollContainerRef]);

    const reset = useCallback(() => {
        touchStartY.current = null;
        committingRef.current = false;
        setSuppressBrowserRefresh(false);
        setPullState(resetPullGesture());
    }, []);

    useEffect(() => {
        if (!enabled) {
            reset();
            return;
        }

        const container = scrollContainerRef.current;
        if (!container) return;

        const onTouchStart = (event: TouchEvent) => {
            if (event.touches.length !== 1) return;
            touchStartY.current = event.touches[0]?.clientY ?? null;
            setPullState((current) =>
                current.phase === "error" ? current : resetPullGesture()
            );
        };

        const onTouchMove = (event: TouchEvent) => {
            if (touchStartY.current === null || event.touches.length !== 1) {
                return;
            }

            const currentY = event.touches[0]?.clientY;
            if (currentY === undefined) return;

            const deltaY = currentY - touchStartY.current;
            const { atTop, atBottom } = getScrollMetrics();
            const next = applyPullMove(pullStateRef.current, {
                deltaY,
                atTop,
                atBottom,
                canGoPrevious,
                canGoNext,
            });

            const isActivePull =
                next.phase === "pulling" ||
                next.phase === "armed" ||
                next.phase === "bound" ||
                next.phase === "locked";

            const isTopPull = isActivePull && next.direction === "previous";
            setSuppressBrowserRefresh(isTopPull);

            if (isActivePull) {
                // Contain overscroll while a chapter-boundary pull is active.
                event.preventDefault();
            }

            setPullState(next);
        };

        const onTouchEnd = async () => {
            setSuppressBrowserRefresh(false);
            const { commit, state } = applyPullEnd(pullStateRef.current);
            setPullState(state);
            touchStartY.current = null;

            if (!commit || committingRef.current) {
                if (!commit) {
                    setPullState(resetPullGesture());
                }
                return;
            }

            committingRef.current = true;
            const succeeded = await onCommit(commit);
            committingRef.current = false;

            if (succeeded) {
                setPullState(resetPullGesture());
            } else {
                setPullState(
                    setPullError(
                        commit,
                        "Couldn't load chapter. Pull again to retry."
                    )
                );
            }
        };

        container.addEventListener("touchstart", onTouchStart, {
            passive: true,
        });
        container.addEventListener("touchmove", onTouchMove, {
            passive: false,
        });
        container.addEventListener("touchend", onTouchEnd);
        container.addEventListener("touchcancel", onTouchEnd);

        return () => {
            container.removeEventListener("touchstart", onTouchStart);
            container.removeEventListener("touchmove", onTouchMove);
            container.removeEventListener("touchend", onTouchEnd);
            container.removeEventListener("touchcancel", onTouchEnd);
        };
    }, [
        canGoNext,
        canGoPrevious,
        enabled,
        getScrollMetrics,
        onCommit,
        reset,
        scrollContainerRef,
    ]);

    useEffect(() => {
        if (!enabled) return;

        if (suppressBrowserRefresh) {
            const previous = document.body.style.overscrollBehaviorY;
            document.body.style.overscrollBehaviorY = "contain";
            return () => {
                document.body.style.overscrollBehaviorY = previous;
            };
        }

        return;
    }, [enabled, suppressBrowserRefresh]);

    return {
        pullState,
        pullLabel: getPullAffordanceLabel(pullState),
        resetPull: reset,
    };
};
