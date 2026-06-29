import type { ChatMessage } from "./OpenAIServices";

export const HIGHLIGHT_CONTEXT_MAX_CHARS = 4000;

export type HighlightContext = {
    sourceType: "epub";
    text: string;
};

export const normalizeHighlightContext = (
    value: unknown
): HighlightContext | null => {
    if (!value || typeof value !== "object") return null;

    const candidate = value as {
        sourceType?: unknown;
        text?: unknown;
    };
    if (candidate.sourceType !== "epub" || typeof candidate.text !== "string") {
        return null;
    }

    const text = candidate.text.trim();
    if (!text) return null;

    return {
        sourceType: "epub",
        text: text.slice(0, HIGHLIGHT_CONTEXT_MAX_CHARS),
    };
};

export const buildRetrievalQuery = (
    query: string,
    highlightContext: HighlightContext | null
) => {
    if (!highlightContext) return query;

    return `${query}\n\nSelected passage:\n${highlightContext.text}`;
};

export const buildBookContextSystemPrompt = (
    bookContext: string,
    highlightContext: HighlightContext | null
) => {
    const selectedPassage = highlightContext
        ? `\n\nSelected passage from the user:\n${highlightContext.text}`
        : "";

    return `Use the following retrieved book excerpts as the primary context for the user's question. If the excerpts do not contain the answer, say that the book context does not provide enough information.${selectedPassage}\n\nBook context:\n${bookContext}`;
};

export const addHighlightContextMessage = (
    messages: ChatMessage[],
    highlightContext: HighlightContext | null
) => {
    if (!highlightContext) return messages;

    return [
        {
            role: "system" as const,
            content: `The user selected this EPUB passage as additional context for their question:\n\n${highlightContext.text}`,
        },
        ...messages,
    ];
};
