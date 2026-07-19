export const CHAT_INPUT_MAX_CHARS = 8_000;

export const normalizeChatInput = (input: string): string | null => {
    const message = input.trim();
    return message && message.length <= CHAT_INPUT_MAX_CHARS ? message : null;
};
