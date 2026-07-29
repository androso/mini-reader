/** Display labels for Codex picker IDs. Platform OpenAI IDs fall through unchanged. */
const CODEX_CHAT_MODEL_LABELS: Record<string, string> = {
    "gpt-5.6": "Sol",
    "gpt-5.6-terra": "Terra",
    "gpt-5.6-luna": "Luna",
    "gpt-5.5": "5.5",
    "gpt-5.4": "5.4",
    "gpt-5.4-mini": "5.4-mini",
};

export const chatModelLabel = (modelId: string) =>
    CODEX_CHAT_MODEL_LABELS[modelId] ?? modelId;
