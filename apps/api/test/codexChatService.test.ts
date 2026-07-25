import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import {
    CODEX_BASE_URL,
    CodexChatService,
} from "../src/services/CodexChatService";
import {
    CODEX_MODEL,
    CODEX_MODELS,
    type CodexOAuthService,
} from "../src/services/CodexOAuthService";

import type { ChatMessage } from "../src/services/OpenAIServices";

test("Codex defaults reader chats to GPT-5.6 Luna", () => {
    assert.equal(CODEX_MODEL, "gpt-5.6-luna");
});

test("Codex receives retrieved book context as response instructions", async () => {
    const calls: Array<{ request: unknown; options: unknown }> = [];
    let clientOptions: ConstructorParameters<typeof OpenAI>[0] | undefined;
    const fakeStream = (async function* () {
        yield { type: "response.output_text.delta", delta: "grounded answer" };
        yield {
            type: "response.completed",
            response: { usage: { input_tokens: 10, output_tokens: 2 } },
        };
    })();
    const fakeClient = {
        responses: {
            create: async (request: unknown, options: unknown) => {
                calls.push({ request, options });
                return fakeStream;
            },
        },
    } as unknown as OpenAI;
    const fakeOAuth = {
        getValidAccessToken: async () => ({
            accessToken: "access-token",
            accountId: "account-id",
        }),
    } as unknown as CodexOAuthService;
    const service = new CodexChatService(fakeOAuth, (options) => {
        clientOptions = options;
        return fakeClient;
    });
    const messages: ChatMessage[] = [
        { role: "system", content: "Retrieved passage from the book." },
        { role: "user", content: "What happened?" },
    ];

    const events = [];
    for await (const event of service.generateStreamResponse(
        "user-id",
        CODEX_MODELS[1],
        messages,
        "You are a helpful assistant."
    )) {
        events.push(event);
    }

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].request, {
        model: CODEX_MODELS[1],
        store: false,
        stream: true,
        instructions:
            "You are a helpful assistant.\n\nRetrieved passage from the book.",
        input: [{ role: "user", content: "What happened?" }],
    });
    assert.equal(clientOptions?.baseURL, CODEX_BASE_URL);
    assert.deepEqual(events, [
        { content: "grounded answer" },
        {
            content: "",
            finishReason: "stop",
            usage: { input_tokens: 10, output_tokens: 2 },
        },
    ]);
});

test("Codex stream failures retain safe provider diagnostics", async () => {
    const fakeStream = (async function* () {
        yield {
            type: "response.failed",
            response: {
                error: {
                    type: "invalid_request_error",
                    code: "model_not_found",
                    message: "The requested model is unavailable.",
                },
            },
        };
    })();
    const fakeClient = {
        responses: {
            create: async () => fakeStream,
        },
    } as unknown as OpenAI;
    const fakeOAuth = {
        getValidAccessToken: async () => ({
            accessToken: "access-token",
            accountId: "account-id",
        }),
    } as unknown as CodexOAuthService;
    const service = new CodexChatService(fakeOAuth, () => fakeClient);

    await assert.rejects(async () => {
        for await (const _event of service.generateStreamResponse(
            "user-id",
            CODEX_MODEL,
            [{ role: "user", content: "Question" }],
            "Instructions"
        )) {
            // Consume the stream so provider failures are observed.
        }
    }, /response\.failed invalid_request_error model_not_found The requested model is unavailable\./);
});
