import type { HighlightContext } from "@reader/contracts";

export const HIGHLIGHT_CONTEXT_MAX_CHARS = 4000;

export type ReaderBridgeMessage =
    | { type: "visible-block"; blockId: string }
    | {
          type: "selection";
          text: string;
          blockId: string;
          chapterId: string;
      }
    | {
          type: "ask-context";
          text: string;
          blockId: string;
          chapterId: string;
      }
    | { type: "pull-state"; edge: "top" | "bottom"; state: "pull" | "release" }
    | { type: "navigate"; direction: "previous" | "next" }
    | { type: "tap" };

export const readerHighlightContextFromMessage = (
    message: ReaderBridgeMessage
): HighlightContext | null => {
    if (message.type !== "selection" && message.type !== "ask-context") {
        return null;
    }

    if (typeof message.text !== "string") return null;
    if (typeof message.chapterId !== "string") return null;
    if (typeof message.blockId !== "string") return null;

    const text = message.text.trim();
    if (!text) return null;

    if (message.type === "ask-context") {
        if (!message.chapterId || !message.blockId) return null;
    }

    return {
        sourceType: "epub",
        text: text.slice(0, HIGHLIGHT_CONTEXT_MAX_CHARS),
        chapterId: message.chapterId,
        blockId: message.blockId,
    };
};
