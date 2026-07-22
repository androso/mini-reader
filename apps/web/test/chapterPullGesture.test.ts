import assert from "node:assert/strict";
import test from "node:test";
import {
    applyPullEnd,
    applyPullMove,
    getPullAffordanceLabel,
    INITIAL_PULL_GESTURE_STATE,
    PULL_ARM_THRESHOLD_PX,
    resetPullGesture,
    setPullError,
} from "../src/lib/chapterPullGesture";

test("upward pull at bottom arms next chapter at 72px and caps at 96px", () => {
    let state = INITIAL_PULL_GESTURE_STATE;

    state = applyPullMove(state, {
        deltaY: -40,
        atTop: false,
        atBottom: true,
        canGoPrevious: true,
        canGoNext: true,
    });
    assert.equal(state.phase, "pulling");
    assert.equal(state.direction, "next");
    assert.equal(getPullAffordanceLabel(state), "Pull for next chapter");

    state = applyPullMove(state, {
        deltaY: -PULL_ARM_THRESHOLD_PX,
        atTop: false,
        atBottom: true,
        canGoPrevious: true,
        canGoNext: true,
    });
    assert.equal(state.phase, "armed");
    assert.equal(getPullAffordanceLabel(state), "Release for next chapter");

    state = applyPullMove(state, {
        deltaY: -200,
        atTop: false,
        atBottom: true,
        canGoPrevious: true,
        canGoNext: true,
    });
    assert.equal(state.displacement, 96);
});

test("downward pull at top arms previous chapter", () => {
    let state = applyPullMove(INITIAL_PULL_GESTURE_STATE, {
        deltaY: 80,
        atTop: true,
        atBottom: false,
        canGoPrevious: true,
        canGoNext: true,
    });
    assert.equal(state.phase, "armed");
    assert.equal(state.direction, "previous");
    assert.equal(getPullAffordanceLabel(state), "Release for previous chapter");
});

test("release below threshold cancels without committing", () => {
    const pulling = applyPullMove(INITIAL_PULL_GESTURE_STATE, {
        deltaY: -40,
        atTop: false,
        atBottom: true,
        canGoPrevious: true,
        canGoNext: true,
    });
    const ended = applyPullEnd(pulling);
    assert.equal(ended.commit, null);
    assert.equal(ended.state.phase, "idle");
});

test("armed release commits once and locks further transitions", () => {
    const armed = applyPullMove(INITIAL_PULL_GESTURE_STATE, {
        deltaY: -80,
        atTop: false,
        atBottom: true,
        canGoPrevious: true,
        canGoNext: true,
    });
    const ended = applyPullEnd(armed);
    assert.equal(ended.commit, "next");
    assert.equal(ended.state.phase, "locked");
    assert.equal(ended.state.transitionArmed, true);

    const movedAgain = applyPullMove(ended.state, {
        deltaY: -90,
        atTop: false,
        atBottom: true,
        canGoPrevious: true,
        canGoNext: true,
    });
    assert.equal(movedAgain.phase, "locked");
    assert.equal(applyPullEnd(movedAgain).commit, null);
});

test("book bounds show messages without arming a transition", () => {
    const atStart = applyPullMove(INITIAL_PULL_GESTURE_STATE, {
        deltaY: 80,
        atTop: true,
        atBottom: false,
        canGoPrevious: false,
        canGoNext: true,
    });
    assert.equal(atStart.phase, "bound");
    assert.equal(getPullAffordanceLabel(atStart), "Beginning of book");
    assert.equal(applyPullEnd(atStart).commit, null);

    const atEnd = applyPullMove(INITIAL_PULL_GESTURE_STATE, {
        deltaY: -80,
        atTop: false,
        atBottom: true,
        canGoPrevious: true,
        canGoNext: false,
    });
    assert.equal(atEnd.phase, "bound");
    assert.equal(getPullAffordanceLabel(atEnd), "End of book");
    assert.equal(applyPullEnd(atEnd).commit, null);
});

test("pull error state is resettable", () => {
    const errored = setPullError("next");
    assert.equal(errored.phase, "error");
    assert.match(getPullAffordanceLabel(errored) ?? "", /retry/i);
    assert.equal(resetPullGesture().phase, "idle");
});
