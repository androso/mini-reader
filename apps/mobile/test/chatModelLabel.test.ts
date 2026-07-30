import assert from "node:assert/strict";
import test from "node:test";
import { chatModelLabel } from "../src/lib/chatModelLabel.js";

test("Codex picker IDs render as short display labels", () => {
    assert.equal(chatModelLabel("gpt-5.6"), "Sol");
    assert.equal(chatModelLabel("gpt-5.6-terra"), "Terra");
    assert.equal(chatModelLabel("gpt-5.6-luna"), "Luna");
    assert.equal(chatModelLabel("gpt-5.5"), "5.5");
    assert.equal(chatModelLabel("gpt-5.4"), "5.4");
    assert.equal(chatModelLabel("gpt-5.4-mini"), "5.4-mini");
});

test("platform OpenAI model IDs keep their wire names", () => {
    assert.equal(chatModelLabel("gpt-4o-mini"), "gpt-4o-mini");
    assert.equal(chatModelLabel("gpt-5.6-sol"), "gpt-5.6-sol");
    assert.equal(
        chatModelLabel("gpt-5.4-mini-2026-03-17"),
        "gpt-5.4-mini-2026-03-17"
    );
});
