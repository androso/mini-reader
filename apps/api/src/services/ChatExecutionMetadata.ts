import {
    Messages,
    type MessageExecutionMetadata,
    type MessageTokenUsage,
} from "../db/schema";

export const PUBLIC_MESSAGE_SELECTION = {
    id: Messages.id,
    conversationId: Messages.conversationId,
    role: Messages.role,
    content: Messages.content,
    contextSources: Messages.contextSources,
    completionStatus: Messages.completionStatus,
    finishReason: Messages.finishReason,
    createdAt: Messages.createdAt,
};

const nonNegativeDuration = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

type TokenCounter =
    | { present: false }
    | { present: true; valid: false }
    | { present: true; valid: true; value: number };

const hasOwn = (value: object, key: PropertyKey) =>
    Object.prototype.hasOwnProperty.call(value, key);

const readTokenCounter = (
    source: Record<string, unknown>,
    key: string
): TokenCounter => {
    if (!hasOwn(source, key)) return { present: false };

    const value = source[key];
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        return { present: true, valid: false };
    }

    return { present: true, valid: true, value };
};

const readCachedTokenCounter = (
    source: Record<string, unknown>,
    key: "prompt_tokens_details" | "input_tokens_details"
): TokenCounter => {
    if (!hasOwn(source, key)) return { present: false };

    const details = source[key];
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return { present: true, valid: false };
    }

    return readTokenCounter(
        details as Record<string, unknown>,
        "cached_tokens"
    );
};

const invalidCounter = (counter: TokenCounter) =>
    counter.present && !counter.valid;

const counterValue = (counter: TokenCounter) =>
    counter.present && counter.valid ? counter.value : 0;

export const normalizeMessageTokenUsage = (
    usage: unknown
): MessageTokenUsage | null => {
    if (!usage || typeof usage !== "object") return null;

    const candidate = usage as Record<string, unknown>;
    const promptTokens = readTokenCounter(candidate, "prompt_tokens");
    const completionTokens = readTokenCounter(candidate, "completion_tokens");
    const inputTokens = readTokenCounter(candidate, "input_tokens");
    const outputTokens = readTokenCounter(candidate, "output_tokens");
    const totalTokens = readTokenCounter(candidate, "total_tokens");
    const promptCachedTokens = readCachedTokenCounter(
        candidate,
        "prompt_tokens_details"
    );
    const inputCachedTokens = readCachedTokenCounter(
        candidate,
        "input_tokens_details"
    );
    const counters = [
        promptTokens,
        completionTokens,
        inputTokens,
        outputTokens,
        totalTokens,
        promptCachedTokens,
        inputCachedTokens,
    ];
    if (counters.some(invalidCounter)) return null;

    const hasChatShape =
        promptTokens.present ||
        completionTokens.present ||
        promptCachedTokens.present;
    const hasResponsesShape =
        inputTokens.present ||
        outputTokens.present ||
        inputCachedTokens.present;
    if (hasChatShape === hasResponsesShape) return null;

    const normalizedInput = hasChatShape ? promptTokens : inputTokens;
    const normalizedOutput = hasChatShape ? completionTokens : outputTokens;
    const normalizedCached = hasChatShape
        ? promptCachedTokens
        : inputCachedTokens;
    if (!normalizedInput.present || !normalizedOutput.present) return null;

    const normalizedInputValue = counterValue(normalizedInput);
    const normalizedOutputValue = counterValue(normalizedOutput);
    const normalizedTotalValue = totalTokens.present
        ? counterValue(totalTokens)
        : normalizedInputValue + normalizedOutputValue;

    return {
        inputTokens: normalizedInputValue,
        cachedInputTokens: Math.min(
            normalizedInputValue,
            counterValue(normalizedCached)
        ),
        outputTokens: normalizedOutputValue,
        totalTokens: normalizedTotalValue,
    };
};

const optionalIdentifier = (value: string | null | undefined) => {
    const normalized = value?.trim();
    return normalized || null;
};

export const buildMessageExecutionMetadata = ({
    modelId,
    generationDurationMs,
    totalLatencyMs,
    usage,
    langfuseTraceId,
}: {
    modelId: string | null;
    generationDurationMs: number;
    totalLatencyMs: number;
    usage: unknown;
    langfuseTraceId?: string;
}): MessageExecutionMetadata => ({
    modelId: optionalIdentifier(modelId),
    generationDurationMs: nonNegativeDuration(generationDurationMs),
    totalLatencyMs: nonNegativeDuration(totalLatencyMs),
    usage: normalizeMessageTokenUsage(usage),
    langfuseTraceId: optionalIdentifier(langfuseTraceId),
});
