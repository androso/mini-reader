import assert from "node:assert/strict";
import test from "node:test";
import {
    OPENAI_CHAT_MAX_TOKENS,
    OPENAI_CHAT_MODELS,
    OPENAI_CHAT_MODEL,
    OPENAI_CHAT_TEMPERATURE,
    PlatformChatService,
    buildChatCompletionRequest,
    createOpenAIClientOptions,
    type ChatMessage,
} from "../src/services/OpenAIServices";
import type OpenAI from "openai";

const messages: ChatMessage[] = [
    {
        role: "user",
        content: "What happened in chapter one?",
    },
];

const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) {
        delete process.env[name];
        return;
    }

    process.env[name] = value;
};

test("chat stream request includes usage capture and model settings", () => {
    const request = buildChatCompletionRequest(messages);

    assert.equal(request.model, OPENAI_CHAT_MODEL);
    assert.equal(request.temperature, OPENAI_CHAT_TEMPERATURE);
    assert.equal(request.max_tokens, OPENAI_CHAT_MAX_TOKENS);
    assert.equal(request.stream, true);
    assert.deepEqual(request.stream_options, { include_usage: true });
    assert.equal(request.messages.length, 2);
    assert.equal(request.messages[0].role, "system");
    assert.equal(request.messages[1].role, "user");
});

test("newer chat models use compatible request parameters", () => {
    for (const model of OPENAI_CHAT_MODELS.filter(
        (candidate) => candidate !== OPENAI_CHAT_MODEL
    )) {
        const request = buildChatCompletionRequest(messages, undefined, model);

        assert.equal(request.model, model);
        assert.equal(request.max_completion_tokens, OPENAI_CHAT_MAX_TOKENS);
        assert.equal(request.max_tokens, undefined);
        assert.equal(request.temperature, undefined);
        assert.equal(request.messages[0].role, "developer");
    }
});

test("OpenAI client options preserve transport hardening", () => {
    const options = createOpenAIClientOptions();

    assert.equal(options.maxRetries, 0);
    assert.deepEqual(options.defaultHeaders, {
        "Accept-Encoding": "identity",
    });
    if (typeof globalThis.fetch === "function") {
        assert.equal(typeof options.fetch, "function");
    }
});

test("stream generation sends the usage-enabled request to the configured client", async () => {
    const previousPublicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const previousSecretKey = process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;

    const calls: Array<{ request: unknown; options: unknown }> = [];
    const fakeStream = (async function* () {
        yield {
            choices: [{ delta: { content: "answer" }, finish_reason: null }],
        };
        yield {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        };
    })();
    const fakeClient = {
        chat: {
            completions: {
                create: async (request: unknown, options: unknown) => {
                    calls.push({ request, options });
                    return fakeStream;
                },
            },
        },
    } as unknown as OpenAI;

    try {
        const service = new PlatformChatService(fakeClient);
        const abortController = new AbortController();
        const result = await service.generateStreamResponse(
            messages,
            undefined,
            { signal: abortController.signal }
        );

        const events = [];
        for await (const event of result) events.push(event);
        assert.deepEqual(events, [
            { content: "answer" },
            {
                content: "",
                finishReason: "stop",
                usage: {
                    prompt_tokens: 2,
                    completion_tokens: 1,
                    total_tokens: 3,
                },
            },
        ]);
        assert.equal(calls.length, 1);
        assert.deepEqual(
            (calls[0].request as { stream_options?: unknown }).stream_options,
            { include_usage: true }
        );
        assert.equal(
            (calls[0].options as { signal?: AbortSignal }).signal,
            abortController.signal
        );
    } finally {
        restoreEnv("LANGFUSE_PUBLIC_KEY", previousPublicKey);
        restoreEnv("LANGFUSE_SECRET_KEY", previousSecretKey);
    }
});
