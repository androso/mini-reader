export const PULL_ARM_THRESHOLD_PX = 72;
export const PULL_MAX_DISPLACEMENT_PX = 96;

export type PullDirection = "previous" | "next";

export type PullPhase =
    | "idle"
    | "pulling"
    | "armed"
    | "bound"
    | "locked"
    | "error";

export type PullGestureState = {
    phase: PullPhase;
    direction: PullDirection | null;
    /** Visual displacement capped at PULL_MAX_DISPLACEMENT_PX */
    displacement: number;
    /** True once a chapter transition has been armed for this touch */
    transitionArmed: boolean;
    errorMessage: string | null;
};

export const INITIAL_PULL_GESTURE_STATE: PullGestureState = {
    phase: "idle",
    direction: null,
    displacement: 0,
    transitionArmed: false,
    errorMessage: null,
};

export const getPullAffordanceLabel = (
    state: PullGestureState
): string | null => {
    if (state.phase === "error" && state.errorMessage) {
        return state.errorMessage;
    }

    if (!state.direction) return null;

    if (state.phase === "bound") {
        return state.direction === "previous"
            ? "Beginning of book"
            : "End of book";
    }

    if (state.phase === "armed" || state.phase === "locked") {
        return state.direction === "previous"
            ? "Release for previous chapter"
            : "Release for next chapter";
    }

    if (state.phase === "pulling") {
        return state.direction === "previous"
            ? "Pull for previous chapter"
            : "Pull for next chapter";
    }

    return null;
};

export type PullMoveInput = {
    /** Finger movement: positive = down, negative = up */
    deltaY: number;
    atTop: boolean;
    atBottom: boolean;
    canGoPrevious: boolean;
    canGoNext: boolean;
};

/**
 * Update pull state during touchmove. Only one transition may arm per touch.
 * Bound edges show a message without arming a chapter change.
 */
export const applyPullMove = (
    state: PullGestureState,
    input: PullMoveInput
): PullGestureState => {
    if (state.phase === "locked" || state.phase === "error") {
        return state;
    }

    const { deltaY, atTop, atBottom, canGoPrevious, canGoNext } = input;

    let direction: PullDirection | null = null;
    let rawDisplacement = 0;

    if (atTop && deltaY > 0) {
        direction = "previous";
        rawDisplacement = deltaY;
    } else if (atBottom && deltaY < 0) {
        direction = "next";
        rawDisplacement = -deltaY;
    }

    if (!direction || rawDisplacement <= 0) {
        if (state.phase === "idle") return state;
        return {
            ...INITIAL_PULL_GESTURE_STATE,
            transitionArmed: state.transitionArmed,
        };
    }

    const displacement = Math.min(rawDisplacement, PULL_MAX_DISPLACEMENT_PX);
    const atBound =
        (direction === "previous" && !canGoPrevious) ||
        (direction === "next" && !canGoNext);

    if (atBound) {
        return {
            phase: "bound",
            direction,
            displacement,
            transitionArmed: state.transitionArmed,
            errorMessage: null,
        };
    }

    if (state.transitionArmed) {
        return {
            phase: "locked",
            direction,
            displacement,
            transitionArmed: true,
            errorMessage: null,
        };
    }

    const armed = displacement >= PULL_ARM_THRESHOLD_PX;
    return {
        phase: armed ? "armed" : "pulling",
        direction,
        displacement,
        transitionArmed: false,
        errorMessage: null,
    };
};

export type PullEndResult = {
    state: PullGestureState;
    /** Direction to navigate when the gesture commits */
    commit: PullDirection | null;
};

/**
 * Resolve touchend. Commits only when armed and not yet transitioned.
 */
export const applyPullEnd = (state: PullGestureState): PullEndResult => {
    if (state.phase === "armed" && state.direction && !state.transitionArmed) {
        return {
            commit: state.direction,
            state: {
                phase: "locked",
                direction: state.direction,
                displacement: state.displacement,
                transitionArmed: true,
                errorMessage: null,
            },
        };
    }

    return {
        commit: null,
        state: INITIAL_PULL_GESTURE_STATE,
    };
};

export const resetPullGesture = (): PullGestureState =>
    INITIAL_PULL_GESTURE_STATE;

export const setPullError = (
    direction: PullDirection | null,
    message = "Couldn't load chapter. Release to retry."
): PullGestureState => ({
    phase: "error",
    direction,
    displacement: 0,
    transitionArmed: false,
    errorMessage: message,
});
