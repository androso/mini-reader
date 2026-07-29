import assert from "node:assert/strict";
import test from "node:test";
import { createSseParserState, pushSseChunk } from "../src/lib/sse";

test("parses SSE events split across arbitrary chunks", () => {
    const state = createSseParserState();
    assert.deepEqual(pushSseChunk(state, 'data: {"cont'), []);
    assert.deepEqual(pushSseChunk(state, 'ent":"Sea"}\n\n'), [
        { content: "Sea" },
    ]);
});

test("ignores done and malformed frames without losing the next event", () => {
    const state = createSseParserState();
    assert.deepEqual(
        pushSseChunk(
            state,
            'data: nope\n\ndata: [DONE]\n\ndata: {"type":"terminal","status":"complete","finishReason":null}\n\n'
        ),
        [{ type: "terminal", status: "complete", finishReason: null }]
    );
});
