import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENAI_API_KEY ??= "chat-completion-service-test-key";

const { ChatCompletionService } =
    require("../src/services/ChatCompletionService") as typeof import("../src/services/ChatCompletionService");
const { OPENAI_CHAT_MODEL } =
    require("../src/services/OpenAIServices") as typeof import("../src/services/OpenAIServices");
const { CODEX_MODEL } =
    require("../src/services/CodexOAuthService") as typeof import("../src/services/CodexOAuthService");

test("ChatCompletionService defaults and rejects invalid OpenAI selection", async () => {
    const previous = process.env.CODEX_OAUTH_ENABLED;
    process.env.CODEX_OAUTH_ENABLED = "false";
    try {
        const service = new ChatCompletionService({
            hasUsableCredentials: async () => false,
        } as any);
        assert.deepEqual(await service.resolveSelection("user-1", undefined), {
            provider: "openai",
            model: OPENAI_CHAT_MODEL,
        });
        assert.deepEqual(await service.resolveSelection("user-1", ""), {
            provider: "openai",
            model: OPENAI_CHAT_MODEL,
        });
        assert.equal(
            await service.resolveSelection("user-1", "not-a-model"),
            null
        );
    } finally {
        if (previous === undefined) delete process.env.CODEX_OAUTH_ENABLED;
        else process.env.CODEX_OAUTH_ENABLED = previous;
    }
});

test("ChatCompletionService defaults and rejects invalid Codex selection when connected", async () => {
    const previous = process.env.CODEX_OAUTH_ENABLED;
    process.env.CODEX_OAUTH_ENABLED = "true";
    try {
        const service = new ChatCompletionService({
            hasUsableCredentials: async () => true,
        } as any);
        assert.deepEqual(await service.resolveSelection("user-1", null), {
            provider: "codex",
            model: CODEX_MODEL,
        });
        assert.equal(await service.resolveSelection("user-1", "gpt-4o"), null);
    } finally {
        if (previous === undefined) delete process.env.CODEX_OAUTH_ENABLED;
        else process.env.CODEX_OAUTH_ENABLED = previous;
    }
});

test("ChatCompletionService delegates streaming to OpenAI and Codex providers", async () => {
    const openaiEvents = [{ type: "delta", text: "hi" }];
    const codexEvents = [{ type: "delta", text: "yo" }];
    const platform = {
        async *generateStreamResponse() {
            yield* openaiEvents;
        },
    };
    const codex = {
        async *generateStreamResponse() {
            yield* codexEvents;
        },
    };
    const service = new ChatCompletionService(
        {} as any,
        platform as any,
        codex as any
    );

    const openCollected = [];
    for await (const event of service.generateStreamResponse(
        "user-1",
        { provider: "openai", model: OPENAI_CHAT_MODEL },
        [],
        "system"
    )) {
        openCollected.push(event);
    }
    assert.deepEqual(openCollected, openaiEvents);

    const codexCollected = [];
    for await (const event of service.generateStreamResponse(
        "user-1",
        { provider: "codex", model: CODEX_MODEL },
        [],
        "system"
    )) {
        codexCollected.push(event);
    }
    assert.deepEqual(codexCollected, codexEvents);
});
