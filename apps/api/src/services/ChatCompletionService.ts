import { isCodexOAuthEnabled } from "./CodexCredentialService";
import { CodexChatService } from "./CodexChatService";
import {
    CODEX_MODEL,
    type CodexModel,
    CodexOAuthService,
    isCodexModel,
} from "./CodexOAuthService";
import {
    OPENAI_CHAT_MODEL,
    type ChatMessage,
    type ChatStreamEvent,
    type GenerateStreamResponseOptions,
    type OpenAIChatModel,
    PlatformChatService,
    isOpenAIChatModel,
} from "./OpenAIServices";

export type ChatProviderSelection =
    | { provider: "openai"; model: OpenAIChatModel }
    | { provider: "codex"; model: CodexModel };

export class ChatCompletionService {
    constructor(
        private readonly oauth = new CodexOAuthService(),
        private readonly platform = new PlatformChatService(),
        private readonly codex = new CodexChatService(oauth)
    ) {}

    async resolveSelection(
        userId: string,
        requestedModel: unknown
    ): Promise<ChatProviderSelection | null> {
        const connected =
            isCodexOAuthEnabled() &&
            (await this.oauth.hasUsableCredentials(userId));
        if (connected) {
            const model =
                requestedModel === undefined ||
                requestedModel === null ||
                requestedModel === ""
                    ? CODEX_MODEL
                    : requestedModel;
            return isCodexModel(model) ? { provider: "codex", model } : null;
        }

        const model =
            requestedModel === undefined ||
            requestedModel === null ||
            requestedModel === ""
                ? OPENAI_CHAT_MODEL
                : requestedModel;
        return isOpenAIChatModel(model) ? { provider: "openai", model } : null;
    }

    async *generateStreamResponse(
        userId: string,
        selection: ChatProviderSelection,
        messages: ChatMessage[],
        systemPrompt: string,
        options?: Omit<GenerateStreamResponseOptions, "model">
    ): AsyncGenerator<ChatStreamEvent> {
        if (selection.provider === "codex") {
            yield* this.codex.generateStreamResponse(
                userId,
                selection.model,
                messages,
                systemPrompt,
                options?.signal
            );
            return;
        }
        yield* await this.platform.generateStreamResponse(
            messages,
            systemPrompt,
            {
                ...options,
                model: selection.model,
            }
        );
    }
}
