import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
    PUBLIC_MESSAGE_SELECTION,
    buildMessageExecutionMetadata,
    normalizeMessageTokenUsage,
} from "../src/services/ChatExecutionMetadata";

test("normalizes OpenAI chat usage without retaining provider payload fields", () => {
    const usage = normalizeMessageTokenUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 150 },
        prompt: "SECRET prompt",
    });

    assert.deepEqual(usage, {
        inputTokens: 100,
        cachedInputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
    });
    assert.deepEqual(Object.keys(usage ?? {}), [
        "inputTokens",
        "cachedInputTokens",
        "outputTokens",
        "totalTokens",
    ]);
    assert.equal(JSON.stringify(usage).includes("SECRET"), false);
});

test("normalizes alternate token names and derives a missing total", () => {
    assert.deepEqual(
        normalizeMessageTokenUsage({
            input_tokens: 12.8,
            output_tokens: 3.9,
            input_tokens_details: { cached_tokens: 4 },
        }),
        {
            inputTokens: 12,
            cachedInputTokens: 4,
            outputTokens: 3,
            totalTokens: 15,
        }
    );
});

test("missing or invalid usage remains nullable", () => {
    for (const usage of [
        null,
        undefined,
        "invalid",
        {},
        { prompt_tokens: -1, completion_tokens: Number.NaN },
    ]) {
        assert.equal(normalizeMessageTokenUsage(usage), null);
    }
});

test("builds only compact allow-listed execution metadata", () => {
    const metadata = buildMessageExecutionMetadata({
        modelId: "  gpt-4o-mini  ",
        generationDurationMs: 25.9,
        totalLatencyMs: 40.4,
        usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            query: "SECRET query",
            objectKey: "SECRET object key",
            pricing: { amount: 99 },
            retrieval: { excerpt: "SECRET excerpt" },
        },
        langfuseTraceId: " trace-1 ",
    });

    assert.deepEqual(metadata, {
        modelId: "gpt-4o-mini",
        generationDurationMs: 25,
        totalLatencyMs: 40,
        usage: {
            inputTokens: 100,
            cachedInputTokens: 0,
            outputTokens: 20,
            totalTokens: 120,
        },
        langfuseTraceId: "trace-1",
    });
    assert.deepEqual(Object.keys(metadata), [
        "modelId",
        "generationDurationMs",
        "totalLatencyMs",
        "usage",
        "langfuseTraceId",
    ]);
    assert.equal(JSON.stringify(metadata).includes("SECRET"), false);
    assert.equal("pricing" in metadata, false);
    assert.equal("retrieval" in metadata, false);
});

test("no-model execution remains truthful and durations are nonnegative", () => {
    assert.deepEqual(
        buildMessageExecutionMetadata({
            modelId: null,
            generationDurationMs: -1,
            totalLatencyMs: Number.NaN,
            usage: null,
        }),
        {
            modelId: null,
            generationDurationMs: 0,
            totalLatencyMs: 0,
            usage: null,
            langfuseTraceId: null,
        }
    );
});

test("public message projection excludes private execution metadata", () => {
    assert.deepEqual(Object.keys(PUBLIC_MESSAGE_SELECTION), [
        "id",
        "conversationId",
        "role",
        "content",
        "contextSources",
        "completionStatus",
        "finishReason",
        "createdAt",
    ]);
    assert.equal("executionMetadata" in PUBLIC_MESSAGE_SELECTION, false);

    const routePath = existsSync("src/routes/Chat.routes.ts")
        ? "src/routes/Chat.routes.ts"
        : "apps/api/src/routes/Chat.routes.ts";
    const routeSource = readFileSync(routePath, "utf8");
    assert.match(
        routeSource,
        /const messages = await db\s*\.select\(PUBLIC_MESSAGE_SELECTION\)\s*\.from\(Messages\)/
    );
});
