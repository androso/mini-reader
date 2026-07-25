import OpenAI from "openai";
import type { ChatMessage, ChatStreamEvent } from "./OpenAIServices";
import { type CodexModel, CodexOAuthService } from "./CodexOAuthService";

export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

export const describeCodexFailure = (event: unknown) => {
    const eventRecord = asRecord(event);
    const response = asRecord(eventRecord?.response);
    const detail = asRecord(response?.error) ?? eventRecord;
    const fields = [
        eventRecord?.type,
        detail?.type,
        detail?.code,
        detail?.param,
        detail?.message,
    ].filter(
        (value): value is string | number =>
            typeof value === "string" || typeof value === "number"
    );
    return fields.length ? fields.join(" ") : "unknown provider error";
};

export class CodexChatService {
    constructor(
        private readonly oauth = new CodexOAuthService(),
        private readonly clientFactory: (
            options: ConstructorParameters<typeof OpenAI>[0]
        ) => OpenAI = (options) => new OpenAI(options)
    ) {}

    async *generateStreamResponse(
        userId: string,
        model: CodexModel,
        messages: ChatMessage[],
        instructions: string,
        signal?: AbortSignal
    ): AsyncGenerator<ChatStreamEvent> {
        const { accessToken, accountId } =
            await this.oauth.getValidAccessToken(userId);
        const client = this.clientFactory({
            apiKey: accessToken,
            baseURL: CODEX_BASE_URL,
            maxRetries: 0,
            defaultHeaders: {
                "chatgpt-account-id": accountId,
                originator: "reader-monorepo",
                "Accept-Encoding": "identity",
            },
        });
        const systemInstructions = messages
            .filter((message) => message.role === "system")
            .map((message) => message.content)
            .join("\n\n");
        const responseInstructions = [instructions, systemInstructions]
            .filter((value) => value.trim().length > 0)
            .join("\n\n");

        try {
            const stream = await client.responses.create(
                {
                    model,
                    store: false,
                    stream: true,
                    instructions: responseInstructions,
                    input: messages
                        .filter(
                            (message) =>
                                message.role === "user" ||
                                message.role === "assistant"
                        )
                        .map((message) => ({
                            role: message.role as "user" | "assistant",
                            content: message.content,
                        })),
                },
                signal ? { signal } : undefined
            );

            for await (const event of stream) {
                if (event.type === "response.output_text.delta") {
                    yield { content: event.delta };
                    continue;
                }
                if (event.type === "response.completed") {
                    yield {
                        content: "",
                        finishReason: "stop",
                        usage: event.response.usage,
                    };
                    continue;
                }
                if (event.type === "response.incomplete") {
                    const reason = event.response.incomplete_details?.reason;
                    yield {
                        content: "",
                        finishReason:
                            reason === "max_output_tokens"
                                ? "length"
                                : "incomplete",
                        usage: event.response.usage,
                    };
                    continue;
                }
                if (
                    event.type === "response.failed" ||
                    event.type === "error"
                ) {
                    throw new Error(
                        `Codex response generation failed: ${describeCodexFailure(event)}`
                    );
                }
            }
        } catch (error) {
            if (signal?.aborted) {
                const abortError = new Error("Request aborted");
                abortError.name = "AbortError";
                throw abortError;
            }
            throw error;
        }
    }
}
