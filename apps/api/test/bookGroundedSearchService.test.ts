import assert from "node:assert/strict";
import test from "node:test";
import {
    BOOK_WEB_SEARCH_MAX_OUTPUT_TOKENS,
    BOOK_WEB_SEARCH_TIMEOUT_MS,
    BookGroundedSearchService,
    buildPublicSearchQuestion,
} from "../src/services/BookGroundedSearchService";

const input = {
    question: "Who played Dorothy in the 1939 film adaptation?",
    history: [{ role: "user" as const, content: "HISTORY_SECRET" }],
    book: {
        title: "The Left Hand of Darkness",
        creator: "Ursula K. Le Guin",
        identifier: "urn:isbn:978...",
        fileType: "epub" as const,
    },
    bookContext: "CHUNK_SECRET",
    highlightContext: { sourceType: "epub" as const, text: "HIGHLIGHT_SECRET" },
};

test("assessment uses a no-tools strict decision request", async () => {
    let request: Record<string, unknown> | undefined;
    const service = new BookGroundedSearchService({
        responses: {
            create: async (value) => {
                request = value;
                return {
                    status: "completed",
                    output_text: JSON.stringify({
                        decision: "search_web",
                        standalonePublicQuestion:
                            "What academic recognition has David Deutsch received?",
                    }),
                };
            },
        },
    });
    assert.deepEqual(await service.assessQuestion(input), {
        kind: "decision",
        decision: "search_web",
        standalonePublicQuestion:
            "What academic recognition has David Deutsch received?",
    });
    assert.equal(request?.store, false);
    assert.equal("tools" in (request ?? {}), false);
    assert.equal(
        (request?.text as { format: { strict: boolean } }).format.strict,
        true
    );
    const classifierInput = JSON.parse(String(request?.input));
    assert.deepEqual(classifierInput.book, input.book);
    assert.doesNotMatch(String(request?.input), /wrong-name\\.epub/);
});

test("assessment fails closed for incomplete and invalid output", async () => {
    for (const response of [
        { status: "incomplete", output_text: "{}" },
        { status: "completed", output_text: "not json" },
        { status: "completed", output_text: '{"decision":"search_web"}' },
        {
            status: "completed",
            output_text:
                '{"decision":"search_web","standalonePublicQuestion":true}',
        },
    ]) {
        const service = new BookGroundedSearchService({
            responses: { create: async () => response },
        });
        assert.deepEqual(await service.assessQuestion(input), {
            kind: "grounding_unavailable",
        });
    }
});

test("assessment accepts null and normalizes unusable standalone questions to null", async () => {
    for (const standalonePublicQuestion of [null, "x", 'Who is "unclosed?']) {
        const service = new BookGroundedSearchService({
            responses: {
                create: async () => ({
                    status: "completed",
                    output_text: JSON.stringify({
                        decision: "answer_from_book",
                        standalonePublicQuestion,
                    }),
                }),
            },
        });
        assert.deepEqual(await service.assessQuestion(input), {
            kind: "decision",
            decision: "answer_from_book",
            standalonePublicQuestion: null,
        });
    }
});

test("public search question strips private spans without inventing terms", () => {
    const reduced = buildPublicSearchQuestion(
        'Who played Dorothy? "PRIVATE QUOTE" `CODE` https://secret.test/a me@example.com 123e4567-e89b-12d3-a456-426614174000 /private/path'
    );
    assert.equal(reduced, "Who played Dorothy?");
    assert.equal(buildPublicSearchQuestion('Who is "unclosed?'), null);
    assert.equal(buildPublicSearchQuestion("x"), null);
    assert.equal(buildPublicSearchQuestion("word ".repeat(100)), null);
});

test("web search receives only the reduced public question and returns safe citations", async () => {
    let request: Record<string, unknown> | undefined;
    const service = new BookGroundedSearchService({
        responses: {
            create: async (value) => {
                request = value;
                return {
                    status: "completed",
                    output_text: "Judy Garland played Dorothy.",
                    usage: {
                        input_tokens: 2,
                        output_tokens: 3,
                        total_tokens: 5,
                    },
                    output: [
                        {
                            type: "message",
                            content: [
                                {
                                    annotations: [
                                        {
                                            type: "url_citation",
                                            url: "https://example.com/cast",
                                            title: "Cast",
                                            end_index: 26,
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                };
            },
        },
    });
    const resolvedQuestion =
        "What academic recognition has David Deutsch received?";
    const result = await service.searchBookWeb({
        publicQuestion: resolvedQuestion,
    });
    assert.equal(
        request?.input,
        JSON.stringify({ question: resolvedQuestion })
    );
    const serialized = JSON.stringify(request);
    for (const secret of [
        "PRIVATE_FILENAME",
        "HISTORY_SECRET",
        "CHUNK_SECRET",
        "HIGHLIGHT_SECRET",
    ])
        assert.equal(serialized.includes(secret), false);
    assert.deepEqual(request?.tools, [
        { type: "web_search", search_context_size: "low" },
    ]);
    assert.equal(request?.tool_choice, "required");
    assert.deepEqual(request?.reasoning, { effort: "low" });
    assert.equal(request?.max_output_tokens, BOOK_WEB_SEARCH_MAX_OUTPUT_TOKENS);
    assert.equal(BOOK_WEB_SEARCH_MAX_OUTPUT_TOKENS, 2_000);
    assert.equal(BOOK_WEB_SEARCH_TIMEOUT_MS, 120_000);
    assert.equal(result.kind, "answer");
    if (result.kind === "answer") {
        assert.equal(result.sources[0]?.sourceType, "web");
        assert.match(result.content, /https:\/\/example\.com\/cast/);
    }
});
