import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db } from "../src/db";
import {
    Books,
    Conversations,
    Messages,
    type MessageExecutionMetadata,
} from "../src/db/schema";
import {
    BOOK_CONTEXT_FAILURE_MESSAGES,
    type BookContextStatus,
} from "../src/services/BookContextState";
import { hybridBookSearchService } from "../src/services/HybridBookSearchService";
import { bookGroundedSearchService } from "../src/services/BookGroundedSearchService";
import {
    PlatformChatService,
    type ChatMessage,
} from "../src/services/OpenAIServices";
import { chatRateLimit } from "../src/middleware/rateLimit";

process.env.JWT_SECRET ??= "book-context-route-test-secret";
process.env.OPENAI_API_KEY ??= "book-context-route-test-key";
const chatRouter = (
    require("../src/routes/Chat.routes") as {
        default: typeof import("../src/routes/Chat.routes").default;
    }
).default;

type RouteLayer = {
    route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
    };
};

const routeHandler = () => {
    const stack = (chatRouter as unknown as { stack: RouteLayer[] }).stack;
    const layer = stack.find(
        (candidate) =>
            candidate.route?.path ===
                "/:resourceType/:rid/conversations/:cid/messages" &&
            candidate.route.methods.post
    );
    assert.ok(layer?.route);
    assert.equal(layer.route.stack.length, 3);
    assert.equal(layer.route.stack[1].handle, chatRateLimit);
    return layer.route.stack[2].handle;
};

const invoke = async (handler: RequestHandler, message = "Question") => {
    const writes: string[] = [];
    let nextError: unknown;
    let writableEnded = false;
    let headersSent = false;
    let resolve!: () => void;
    const completed = new Promise<void>((done) => {
        resolve = done;
    });
    const response = {
        get writableEnded() {
            return writableEnded;
        },
        destroyed: false,
        get headersSent() {
            return headersSent;
        },
        setHeader() {
            return this;
        },
        write(chunk: string) {
            headersSent = true;
            writes.push(chunk);
            return true;
        },
        end() {
            writableEnded = true;
            resolve();
            return this;
        },
        status() {
            return this;
        },
        send() {
            writableEnded = true;
            resolve();
            return this;
        },
        once() {
            return this;
        },
        off() {
            return this;
        },
    } as unknown as Response;
    const request = {
        params: {
            resourceType: "book",
            rid: "book-1",
            cid: "conversation-1",
        },
        body: { message },
        user: {
            id: "user-1",
            email: "owner@example.com",
            name: "Owner",
            googleId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    } as unknown as Request;
    const next: NextFunction = (error?: unknown) => {
        nextError = error;
        resolve();
    };

    handler(request, response, next);
    let timeout: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            completed,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error("route timed out")),
                    2_000
                );
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }

    return { nextError, writes };
};

type FailureContextStatus = Exclude<
    BookContextStatus,
    "ready" | "no_relevant_context"
>;

const failureWrites = (status: FailureContextStatus) => [
    `data: ${JSON.stringify({
        error: BOOK_CONTEXT_FAILURE_MESSAGES[status],
        status,
    })}\n\n`,
    `data: ${JSON.stringify({
        type: "terminal",
        status: "failed",
        finishReason: status,
    })}\n\n`,
    "data: [DONE]\n\n",
];

test("book context states fail closed before model generation", async () => {
    const handler = routeHandler();
    const originalSelect = db.select;
    const originalInsert = db.insert;
    const originalUpdate = db.update;
    const originalSearch = hybridBookSearchService.search;
    const originalGenerate =
        PlatformChatService.prototype.generateStreamResponse;
    const scenarios: Array<{
        name: string;
        expectedStatus: FailureContextStatus;
        book?: { processingStatus: string; collectionName: string | null };
        lookupError?: boolean;
        searchError?: boolean;
    }> = [
        { name: "missing", expectedStatus: "not_found" },
        {
            name: "deleting",
            expectedStatus: "not_found",
            book: {
                processingStatus: "deleting",
                collectionName: "book_old",
            },
        },
        {
            name: "failed ingestion",
            expectedStatus: "ingestion_failed",
            book: { processingStatus: "failed", collectionName: null },
        },
        {
            name: "queue failure",
            expectedStatus: "ingestion_failed",
            book: { processingStatus: "queue_failed", collectionName: null },
        },
        {
            name: "processing",
            expectedStatus: "processing",
            book: {
                processingStatus: "processing",
                collectionName: "book_partial",
            },
        },
        {
            name: "ready without collection",
            expectedStatus: "retrieval_unavailable",
            book: { processingStatus: "ready", collectionName: null },
        },
        {
            name: "unknown processing state",
            expectedStatus: "retrieval_unavailable",
            book: {
                processingStatus: "unexpected",
                collectionName: "book_unknown",
            },
        },
        {
            name: "lookup unavailable",
            expectedStatus: "retrieval_unavailable",
            lookupError: true,
        },
        {
            name: "search unavailable",
            expectedStatus: "retrieval_unavailable",
            book: {
                processingStatus: "ready",
                collectionName: "book_ready",
            },
            searchError: true,
        },
    ];

    try {
        for (const scenario of scenarios) {
            let bookLookups = 0;
            let retrievals = 0;
            let modelCalls = 0;
            const insertedMessages: unknown[] = [];

            db.select = (() => ({
                from: (table: unknown) => ({
                    where: () => {
                        if (table === Conversations) {
                            return Promise.resolve([{ id: "conversation-1" }]);
                        }
                        if (table === Messages) {
                            return { orderBy: async () => [] };
                        }
                        assert.equal(table, Books);
                        bookLookups++;
                        if (bookLookups === 1) {
                            return Promise.resolve([
                                { id: "book-1", userId: "user-1" },
                            ]);
                        }
                        if (scenario.lookupError) {
                            return Promise.reject(
                                new Error("SECRET raw lookup error")
                            );
                        }
                        return Promise.resolve(
                            scenario.book
                                ? [
                                      {
                                          id: "book-1",
                                          userId: "user-1",
                                          processingError:
                                              "SECRET raw ingestion error",
                                          ...scenario.book,
                                      },
                                  ]
                                : []
                        );
                    },
                }),
            })) as unknown as typeof db.select;
            db.insert = ((table: unknown) => ({
                values: async (values: unknown) => {
                    assert.equal(table, Messages);
                    insertedMessages.push(values);
                },
            })) as unknown as typeof db.insert;
            db.update = (() => ({
                set: () => ({ where: async () => undefined }),
            })) as unknown as typeof db.update;
            hybridBookSearchService.search = async () => {
                retrievals++;
                if (scenario.searchError) {
                    throw new Error("SECRET raw retrieval error");
                }
                return [];
            };
            PlatformChatService.prototype.generateStreamResponse = async () => {
                modelCalls++;
                return (async function* () {})();
            };

            const result = await invoke(handler);

            assert.equal(result.nextError, undefined, scenario.name);
            assert.deepEqual(
                result.writes,
                failureWrites(scenario.expectedStatus),
                scenario.name
            );
            assert.equal(
                result.writes.join("").includes("SECRET"),
                false,
                scenario.name
            );
            assert.equal(
                retrievals,
                scenario.searchError ? 1 : 0,
                scenario.name
            );
            assert.equal(modelCalls, 0, scenario.name);
            assert.deepEqual(
                insertedMessages,
                [
                    {
                        conversationId: "conversation-1",
                        role: "user",
                        content: "Question",
                    },
                ],
                scenario.name
            );
        }
    } finally {
        db.select = originalSelect;
        db.insert = originalInsert;
        db.update = originalUpdate;
        hybridBookSearchService.search = originalSearch;
        PlatformChatService.prototype.generateStreamResponse = originalGenerate;
    }
});

test("no-match is persisted refusal while ready passages alone reach OpenAI", async () => {
    const handler = routeHandler();
    const originalSelect = db.select;
    const originalInsert = db.insert;
    const originalUpdate = db.update;
    const originalSearch = hybridBookSearchService.search;
    const originalGenerate =
        PlatformChatService.prototype.generateStreamResponse;
    const originalAssess = bookGroundedSearchService.assessQuestion;
    const originalWebSearch = bookGroundedSearchService.searchBookWeb;

    try {
        for (const hasPassages of [false, true]) {
            let modelCalls = 0;
            let webSearchCalls = 0;
            const insertedMessages: unknown[] = [];
            const generatedMessageBatches: ChatMessage[][] = [];
            db.select = (() => ({
                from: (table: unknown) => ({
                    where: () => {
                        if (table === Conversations) {
                            return Promise.resolve([{ id: "conversation-1" }]);
                        }
                        if (table === Messages) {
                            return { orderBy: async () => [] };
                        }
                        assert.equal(table, Books);
                        return Promise.resolve([
                            {
                                id: "book-1",
                                userId: "user-1",
                                processingStatus: "ready",
                                title: "A Wizard of Earthsea",
                                originalFilename: "private.epub",
                                embeddedTitle: "A Wizard of Earthsea",
                                creator: "Ursula K. Le Guin",
                                identifier: "urn:isbn:test",
                                metadataExtractedAt: new Date(
                                    "2026-07-25T00:00:00.000Z"
                                ),
                                fileType: "epub",
                                fileKey: "users/user-1/private.epub",
                                createdAt: new Date("2026-07-25T00:00:00.000Z"),
                                processingError: null,
                                collectionName: "book_ready",
                            },
                        ]);
                    },
                }),
            })) as unknown as typeof db.select;
            db.insert = ((table: unknown) => ({
                values: async (values: unknown) => {
                    assert.equal(table, Messages);
                    insertedMessages.push(values);
                },
            })) as unknown as typeof db.insert;
            db.update = (() => ({
                set: () => ({ where: async () => undefined }),
            })) as unknown as typeof db.update;
            hybridBookSearchService.search = async () =>
                hasPassages
                    ? [
                          {
                              id: "chunk-1",
                              chunkIndex: 0,
                              content: "relevant passage",
                              score: 1,
                              bestRank: 1,
                          },
                      ]
                    : [];
            bookGroundedSearchService.assessQuestion = async () => ({
                kind: "decision",
                decision: hasPassages ? "answer_from_book" : "search_web",
                standalonePublicQuestion: hasPassages ? "Question" : null,
            });
            bookGroundedSearchService.searchBookWeb = async () => {
                webSearchCalls++;
                return {
                    kind: "no_cited_answer",
                    usage: null,
                };
            };
            PlatformChatService.prototype.generateStreamResponse = async (
                messages
            ) => {
                generatedMessageBatches.push(messages);
                modelCalls++;
                return (async function* () {
                    yield { content: "model answer" };
                    yield {
                        content: "",
                        finishReason: "stop",
                        usage: {
                            prompt_tokens: 8,
                            completion_tokens: 2,
                            total_tokens: 10,
                        },
                    };
                })();
            };

            const result = await invoke(handler);

            assert.equal(result.nextError, undefined);
            assert.equal(modelCalls, hasPassages ? 1 : 0);
            assert.equal(webSearchCalls, 0);
            assert.equal(
                result.writes.filter((frame) =>
                    frame.includes('"type":"status"')
                ).length,
                0
            );
            if (!hasPassages) {
                assert.deepEqual(result.writes, [
                    `data: ${JSON.stringify({
                        content:
                            "I couldn't find reliable public sources about this book. Try naming the person, character, place, or adaptation directly.",
                    })}\n\n`,
                    `data: ${JSON.stringify({
                        type: "terminal",
                        status: "complete",
                        finishReason: "no_relevant_web_context",
                    })}\n\n`,
                    "data: [DONE]\n\n",
                ]);
                const assistantMessage = insertedMessages[1];
                assert.ok(
                    assistantMessage &&
                        typeof assistantMessage === "object" &&
                        "executionMetadata" in assistantMessage
                );
                const executionMetadata = assistantMessage.executionMetadata;
                assert.ok(
                    executionMetadata &&
                        typeof executionMetadata === "object" &&
                        "generationDurationMs" in executionMetadata &&
                        typeof executionMetadata.generationDurationMs ===
                            "number" &&
                        "totalLatencyMs" in executionMetadata &&
                        typeof executionMetadata.totalLatencyMs === "number"
                );
                assert.deepEqual(executionMetadata, {
                    modelId: null,
                    generationDurationMs:
                        executionMetadata.generationDurationMs,
                    totalLatencyMs: executionMetadata.totalLatencyMs,
                    usage: null,
                    langfuseTraceId: null,
                });
                assert.ok(Number.isInteger(executionMetadata.totalLatencyMs));
                assert.ok(executionMetadata.totalLatencyMs >= 0);
                assert.deepEqual(insertedMessages[1], {
                    conversationId: "conversation-1",
                    role: "assistant",
                    content:
                        "I couldn't find reliable public sources about this book. Try naming the person, character, place, or adaptation directly.",
                    contextSources: null,
                    completionStatus: "complete",
                    finishReason: "no_relevant_web_context",
                    executionMetadata,
                });
                continue;
            }

            const evidenceMessage = generatedMessageBatches[0]?.[0];
            assert.equal(evidenceMessage?.role, "user");
            assert.match(
                evidenceMessage?.content ?? "",
                /A Wizard of Earthsea/
            );
            assert.match(evidenceMessage?.content ?? "", /relevant passage/);
            assert.doesNotMatch(
                evidenceMessage?.content ?? "",
                /private\.epub/
            );
            assert.doesNotMatch(evidenceMessage?.content ?? "", /book_ready/);

            assert.deepEqual(result.writes, [
                `data: ${JSON.stringify({ content: "model answer" })}\n\n`,
                `data: ${JSON.stringify({
                    type: "sources",
                    sources: [
                        {
                            sourceType: "book",
                            id: "chunk-1",
                            chunkIndex: 0,
                            score: 1,
                            bestRank: 1,
                            excerpt: "relevant passage",
                        },
                    ],
                })}\n\n`,
                `data: ${JSON.stringify({
                    type: "terminal",
                    status: "complete",
                    finishReason: "stop",
                })}\n\n`,
                "data: [DONE]\n\n",
            ]);
            const readyMetadata = (
                insertedMessages[1] as {
                    executionMetadata: MessageExecutionMetadata;
                }
            ).executionMetadata;
            assert.equal(readyMetadata.modelId, "gpt-4o-mini");
            assert.ok(Number.isInteger(readyMetadata.generationDurationMs));
            assert.ok(readyMetadata.generationDurationMs >= 0);
            assert.ok(
                readyMetadata.totalLatencyMs >=
                    readyMetadata.generationDurationMs
            );
            assert.deepEqual(readyMetadata.usage, {
                inputTokens: 8,
                cachedInputTokens: 0,
                outputTokens: 2,
                totalTokens: 10,
            });
            assert.equal(readyMetadata.langfuseTraceId, null);
        }
    } finally {
        db.select = originalSelect;
        db.insert = originalInsert;
        db.update = originalUpdate;
        hybridBookSearchService.search = originalSearch;
        PlatformChatService.prototype.generateStreamResponse = originalGenerate;
        bookGroundedSearchService.assessQuestion = originalAssess;
        bookGroundedSearchService.searchBookWeb = originalWebSearch;
    }
});

test("resolved follow-up uses only the standalone public question for web search", async () => {
    const handler = routeHandler();
    const originalSelect = db.select;
    const originalInsert = db.insert;
    const originalUpdate = db.update;
    const originalSearch = hybridBookSearchService.search;
    const originalAssess = bookGroundedSearchService.assessQuestion;
    const originalWebSearch = bookGroundedSearchService.searchBookWeb;
    const insertedMessages: unknown[] = [];
    const resolvedQuestion =
        "What academic recognition has David Deutsch received?";
    const answer =
        "David Deutsch is a Fellow of the Royal Society. [1](<https://example.com/david-deutsch>)";
    const sources = [
        {
            sourceType: "web" as const,
            url: "https://example.com/david-deutsch",
            title: "David Deutsch",
        },
    ];
    let webSearchInput:
        | { publicQuestion: string; signal?: AbortSignal }
        | undefined;

    try {
        db.select = (() => ({
            from: (table: unknown) => ({
                where: () => {
                    if (table === Conversations) {
                        return Promise.resolve([{ id: "conversation-1" }]);
                    }
                    if (table === Messages) {
                        return {
                            orderBy: async () => [
                                {
                                    id: "message-1",
                                    role: "user",
                                    content: "Who is the author?",
                                    createdAt: new Date(
                                        "2026-07-25T00:00:00.000Z"
                                    ),
                                },
                                {
                                    id: "message-2",
                                    role: "assistant",
                                    content: "The author is David Deutsch.",
                                    createdAt: new Date(
                                        "2026-07-25T00:00:01.000Z"
                                    ),
                                },
                            ],
                        };
                    }
                    assert.equal(table, Books);
                    return Promise.resolve([
                        {
                            id: "book-1",
                            userId: "user-1",
                            processingStatus: "ready",
                            title: "The Fabric of Reality",
                            originalFilename: "private.epub",
                            embeddedTitle: "The Fabric of Reality",
                            creator: "David Deutsch",
                            identifier: "urn:isbn:test",
                            metadataExtractedAt: new Date(
                                "2026-07-25T00:00:00.000Z"
                            ),
                            fileType: "epub",
                            fileKey: "users/user-1/private.epub",
                            createdAt: new Date("2026-07-25T00:00:00.000Z"),
                            processingError: null,
                            collectionName: "book_ready",
                        },
                    ]);
                },
            }),
        })) as unknown as typeof db.select;
        db.insert = ((table: unknown) => ({
            values: async (values: unknown) => {
                assert.equal(table, Messages);
                insertedMessages.push(values);
            },
        })) as unknown as typeof db.insert;
        db.update = (() => ({
            set: () => ({ where: async () => undefined }),
        })) as unknown as typeof db.update;
        hybridBookSearchService.search = async () => [];
        bookGroundedSearchService.assessQuestion = async () => ({
            kind: "decision",
            decision: "search_web",
            standalonePublicQuestion: resolvedQuestion,
        });
        bookGroundedSearchService.searchBookWeb = async (input) => {
            webSearchInput = input;
            return { kind: "answer", content: answer, sources, usage: null };
        };

        const result = await invoke(
            handler,
            "What are his recognitions in the academic world?"
        );

        assert.equal(result.nextError, undefined);
        assert.equal(webSearchInput?.publicQuestion, resolvedQuestion);
        assert.doesNotMatch(
            JSON.stringify(webSearchInput),
            /What are his recognitions|Who is the author|The author is David Deutsch/
        );
        assert.deepEqual(result.writes, [
            `data: ${JSON.stringify({
                type: "status",
                status: "searching_web",
            })}\n\n`,
            `data: ${JSON.stringify({ content: answer })}\n\n`,
            `data: ${JSON.stringify({ type: "sources", sources })}\n\n`,
            `data: ${JSON.stringify({
                type: "terminal",
                status: "complete",
                finishReason: "web_search",
            })}\n\n`,
            "data: [DONE]\n\n",
        ]);
        const assistantMessage = insertedMessages[1];
        assert.ok(
            assistantMessage &&
                typeof assistantMessage === "object" &&
                "executionMetadata" in assistantMessage
        );
        const executionMetadata = assistantMessage.executionMetadata;
        assert.deepEqual(insertedMessages[1], {
            conversationId: "conversation-1",
            role: "assistant",
            content: answer,
            contextSources: sources,
            completionStatus: "complete",
            finishReason: "web_search",
            executionMetadata,
        });
    } finally {
        db.select = originalSelect;
        db.insert = originalInsert;
        db.update = originalUpdate;
        hybridBookSearchService.search = originalSearch;
        bookGroundedSearchService.assessQuestion = originalAssess;
        bookGroundedSearchService.searchBookWeb = originalWebSearch;
    }
});
