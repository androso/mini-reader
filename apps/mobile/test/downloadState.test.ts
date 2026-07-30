import assert from "node:assert/strict";
import test from "node:test";
import {
    canOpenOffline,
    nextDownloadStatus,
} from "../src/lib/downloadState.js";

test("only a completed download is available offline", () => {
    assert.equal(canOpenOffline("downloading"), false);
    assert.equal(canOpenOffline("failed"), false);
    assert.equal(canOpenOffline("complete"), true);
});

test("a failed download can be resumed and completed", () => {
    let state = nextDownloadStatus("failed", "start");
    state = nextDownloadStatus(state, "complete");
    assert.equal(state, "complete");
});
