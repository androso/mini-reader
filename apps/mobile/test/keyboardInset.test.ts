import assert from "node:assert/strict";
import test from "node:test";
import { chatOverlayBottom } from "../src/lib/keyboardInset.js";

test("chatOverlayBottom uses max(safeBottom, restingGap) when keyboardHeight <= 0", () => {
    assert.equal(
        chatOverlayBottom({
            keyboardHeight: 0,
            safeBottom: 34,
            restingGap: 12,
        }),
        34
    );
    assert.equal(
        chatOverlayBottom({
            keyboardHeight: -1,
            safeBottom: 10,
            restingGap: 16,
        }),
        16
    );
});

test("chatOverlayBottom adds keyboardGap when keyboard is visible", () => {
    assert.equal(
        chatOverlayBottom({
            keyboardHeight: 300,
            safeBottom: 34,
            restingGap: 12,
        }),
        304
    );
    assert.equal(
        chatOverlayBottom({
            keyboardHeight: 200,
            safeBottom: 0,
            restingGap: 0,
            keyboardGap: 8,
        }),
        208
    );
});
