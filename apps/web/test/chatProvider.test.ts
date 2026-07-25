import assert from "node:assert/strict";
import test from "node:test";
import {
    CODEX_CHAT_MODELS,
    PLATFORM_CHAT_MODELS,
    chatModelOptions,
    type ChatProviderStatus,
} from "../src/lib/chatProvider";

const status = (
    overrides: Partial<ChatProviderStatus>
): ChatProviderStatus => ({
    codexAvailable: true,
    provider: "openai",
    connected: false,
    reauthRequired: false,
    account: null,
    models: PLATFORM_CHAT_MODELS.map((model) => model.value),
    defaultModel: PLATFORM_CHAT_MODELS[0].value,
    ...overrides,
});

test("platform model picker exposes the supported OpenAI catalog", () => {
    assert.deepEqual(
        PLATFORM_CHAT_MODELS.map(({ value }) => value),
        [
            "gpt-4o-mini",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5-2026-04-23",
            "gpt-5.4-2026-03-05",
            "gpt-5.4-mini-2026-03-17",
            "gpt-5.4-nano-2026-03-17",
        ]
    );
});

test("connected Codex users see every subscription model in the reader picker", () => {
    const connected = status({
        provider: "codex",
        connected: true,
        models: CODEX_CHAT_MODELS.map(({ value }) => value),
        defaultModel: CODEX_CHAT_MODELS[0].value,
    });
    assert.deepEqual(chatModelOptions(connected), CODEX_CHAT_MODELS);
    assert.equal(
        connected.models.includes(PLATFORM_CHAT_MODELS[0].value),
        false
    );
    assert.deepEqual(
        CODEX_CHAT_MODELS.map(({ value }) => value),
        [
            "gpt-5.6",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.4",
            "gpt-5.4-mini",
        ]
    );
});

test("disconnect returns model options and stale selection to Platform defaults", () => {
    const connected = status({
        provider: "codex",
        connected: true,
        models: CODEX_CHAT_MODELS.map(({ value }) => value),
        defaultModel: CODEX_CHAT_MODELS[0].value,
    });
    let selectedModel = connected.defaultModel;
    const disconnected = status({});
    if (!disconnected.models.includes(selectedModel)) {
        selectedModel = disconnected.defaultModel;
    }
    assert.equal(selectedModel, "gpt-4o-mini");
    assert.deepEqual(chatModelOptions(disconnected), PLATFORM_CHAT_MODELS);
});
