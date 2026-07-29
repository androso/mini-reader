import type { ChatStreamEvent } from "@reader/contracts";

export type SseParserState = { buffer: string };

export const createSseParserState = (): SseParserState => ({ buffer: "" });

export const pushSseChunk = (
    state: SseParserState,
    chunk: string
): ChatStreamEvent[] => {
    state.buffer += chunk.replace(/\r\n/g, "\n");
    const events: ChatStreamEvent[] = [];
    let boundary = state.buffer.indexOf("\n\n");
    while (boundary >= 0) {
        const frame = state.buffer.slice(0, boundary);
        state.buffer = state.buffer.slice(boundary + 2);
        const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
        if (data && data !== "[DONE]") {
            try {
                events.push(JSON.parse(data) as ChatStreamEvent);
            } catch {
                // A malformed server event is isolated to its own SSE frame.
            }
        }
        boundary = state.buffer.indexOf("\n\n");
    }
    return events;
};
