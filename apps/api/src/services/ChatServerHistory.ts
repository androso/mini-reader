import type { ChatMessage } from "./OpenAIServices";

export const CHAT_MESSAGE_MAX_CHARS = 8_000;
export const CHAT_HISTORY_MAX_MESSAGES = 30;
export const CHAT_HISTORY_MAX_CHARS = 60_000;

export type StoredChatMessage = ChatMessage & {
    id: string;
    createdAt: Date;
};

export type ChatServerHistoryRepository = {
    loadMessages(conversationId: string): Promise<StoredChatMessage[]>;
    insertUserMessage(conversationId: string, content: string): Promise<void>;
};

export type ProjectedChatRequest = {
    message: string;
    model: unknown;
    highlightContext?: unknown;
};

export const projectChatRequest = (
    body: unknown
): ProjectedChatRequest | null => {
    if (!body || typeof body !== "object") return null;

    const submitted = body as Record<string, unknown>;
    if (typeof submitted.message !== "string") return null;

    const message = submitted.message.trim();
    if (!message || message.length > CHAT_MESSAGE_MAX_CHARS) return null;

    return {
        message,
        model: submitted.model,
        ...(submitted.highlightContext === undefined
            ? {}
            : { highlightContext: submitted.highlightContext }),
    };
};

export const orderStoredMessages = (
    messages: StoredChatMessage[]
): StoredChatMessage[] =>
    [...messages].sort(
        (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.id.localeCompare(right.id)
    );

export const boundChatHistory = (messages: ChatMessage[]): ChatMessage[] => {
    const selected: ChatMessage[] = [];
    let characterCount = 0;

    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (selected.length === CHAT_HISTORY_MAX_MESSAGES) break;
        if (characterCount + message.content.length > CHAT_HISTORY_MAX_CHARS) {
            break;
        }
        selected.push(message);
        characterCount += message.content.length;
    }

    return selected.reverse();
};

/**
 * Loads persisted history, then persists the new user message before returning
 * model input. The user row intentionally remains committed if retrieval, model
 * setup, or streaming fails after this function resolves.
 */
export const persistUserMessageAndBuildHistory = async ({
    conversationId,
    message,
    repository,
}: {
    conversationId: string;
    message: string;
    repository: ChatServerHistoryRepository;
}): Promise<ChatMessage[]> => {
    const stored = orderStoredMessages(
        await repository.loadMessages(conversationId)
    );
    await repository.insertUserMessage(conversationId, message);

    return boundChatHistory([
        ...stored.map(({ role, content }) => ({ role, content })),
        { role: "user", content: message },
    ]);
};
