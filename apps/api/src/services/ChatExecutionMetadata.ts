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

const nonNegativeInteger = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

export const normalizeMessageTokenUsage = (
    usage: unknown
): MessageTokenUsage | null => {
    if (!usage || typeof usage !== "object") return null;

    const candidate = usage as {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        total_tokens?: unknown;
        input_tokens?: unknown;
        output_tokens?: unknown;
        prompt_tokens_details?: { cached_tokens?: unknown };
        input_tokens_details?: { cached_tokens?: unknown };
    };
    const inputTokens = nonNegativeInteger(
        candidate.prompt_tokens ?? candidate.input_tokens
    );
    const outputTokens = nonNegativeInteger(
        candidate.completion_tokens ?? candidate.output_tokens
    );
    const cachedInputTokens = Math.min(
        inputTokens,
        nonNegativeInteger(
            candidate.prompt_tokens_details?.cached_tokens ??
                candidate.input_tokens_details?.cached_tokens
        )
    );
    const totalTokens = nonNegativeInteger(candidate.total_tokens);

    if (!inputTokens && !outputTokens && !totalTokens) return null;

    return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        totalTokens: totalTokens || inputTokens + outputTokens,
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
    generationDurationMs: nonNegativeInteger(generationDurationMs),
    totalLatencyMs: nonNegativeInteger(totalLatencyMs),
    usage: normalizeMessageTokenUsage(usage),
    langfuseTraceId: optionalIdentifier(langfuseTraceId),
});
