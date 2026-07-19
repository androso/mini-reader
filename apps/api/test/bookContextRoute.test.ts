import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db } from "../src/db";
import { Books, Conversations, Messages } from "../src/db/schema";
import {
    BOOK_CONTEXT_FAILURE_MESSAGES,
    NO_RELEVANT_BOOK_CONTEXT_RESPONSE,
    type BookContextStatus,
} from "../src/services/BookContextState";
import { hybridBookSearchService } from "../src/services/HybridBookSearchService";
import { OpenAIService } from "../src/services/OpenAIServices";

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
    return layer.route.stack[1].handle;
};

const invoke = async (handler: RequestHandler) => {
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
        body: { message: "Question" },
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
    const originalGenerate = OpenAIService.prototype.generateStreamResponse;
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
            OpenAIService.prototype.generateStreamResponse = async () => {
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
        OpenAIService.prototype.generateStreamResponse = originalGenerate;
    }
});

test("no-match is persisted refusal while ready passages alone reach OpenAI", async () => {
    const handler = routeHandler();
    const originalSelect = db.select;
    const originalInsert = db.insert;
    const originalUpdate = db.update;
    const originalSearch = hybridBookSearchService.search;
    const originalGenerate = OpenAIService.prototype.generateStreamResponse;

    try {
        for (const hasPassages of [false, true]) {
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
                        return Promise.resolve([
                            {
                                id: "book-1",
                                userId: "user-1",
                                processingStatus: "ready",
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
            OpenAIService.prototype.generateStreamResponse = async () => {
                modelCalls++;
                return (async function* () {
                    yield {
                        choices: [
                            {
                                delta: { content: "model answer" },
                                finish_reason: "stop",
                            },
                        ],
                    } as never;
                })();
            };

            const result = await invoke(handler);

            assert.equal(result.nextError, undefined);
            assert.equal(modelCalls, hasPassages ? 1 : 0);
            if (!hasPassages) {
                assert.deepEqual(result.writes, [
                    `data: ${JSON.stringify({
                        content: NO_RELEVANT_BOOK_CONTEXT_RESPONSE,
                    })}\n\n`,
                    `data: ${JSON.stringify({
                        type: "terminal",
                        status: "complete",
                        finishReason: "no_relevant_context",
                    })}\n\n`,
                    "data: [DONE]\n\n",
                ]);
                assert.deepEqual(insertedMessages[1], {
                    conversationId: "conversation-1",
                    role: "assistant",
                    content: NO_RELEVANT_BOOK_CONTEXT_RESPONSE,
                    contextSources: null,
                    completionStatus: "complete",
                    finishReason: "no_relevant_context",
                });
                continue;
            }

            assert.deepEqual(result.writes, [
                `data: ${JSON.stringify({ content: "model answer" })}\n\n`,
                `data: ${JSON.stringify({
                    type: "sources",
                    sources: [
                        {
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
        }
    } finally {
        db.select = originalSelect;
        db.insert = originalInsert;
        db.update = originalUpdate;
        hybridBookSearchService.search = originalSearch;
        OpenAIService.prototype.generateStreamResponse = originalGenerate;
    }
});
