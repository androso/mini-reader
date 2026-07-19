import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db } from "../src/db";
import { Books, Conversations, Messages } from "../src/db/schema";
import { hybridBookSearchService } from "../src/services/HybridBookSearchService";
import { OpenAIService } from "../src/services/OpenAIServices";

process.env.JWT_SECRET ??= "chat-route-authorization-test-secret";
process.env.OPENAI_API_KEY ??= "chat-route-authorization-test-key";
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

const routeHandler = (path: string, method: "get" | "post") => {
    const stack = (chatRouter as unknown as { stack: RouteLayer[] }).stack;
    const layer = stack.find(
        (candidate) =>
            candidate.route?.path === path && candidate.route.methods[method]
    );
    assert.ok(layer?.route);
    assert.equal(layer.route.stack.length, 2, "authenticate must remain first");
    return layer.route.stack[1].handle;
};

const invoke = async (
    handler: RequestHandler,
    req: Partial<Request>,
    responseOverrides: Partial<Response> = {}
) => {
    const writes: string[] = [];
    const headers: Array<[string, string]> = [];
    let statusCode = 200;
    let body: unknown;
    let nextError: unknown;
    let headersSent = false;
    let writableEnded = false;
    let settled = false;
    let resolve!: () => void;
    const completed = new Promise<void>((done) => {
        resolve = done;
    });
    const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
    };
    const response = {
        get headersSent() {
            return headersSent;
        },
        get writableEnded() {
            return writableEnded;
        },
        status(code: number) {
            statusCode = code;
            return this;
        },
        send(payload: unknown) {
            body = payload;
            headersSent = true;
            writableEnded = true;
            finish();
            return this;
        },
        setHeader(name: string, value: string) {
            headers.push([name, value]);
            return this;
        },
        write(chunk: string) {
            headersSent = true;
            writes.push(chunk);
            return true;
        },
        end() {
            writableEnded = true;
            finish();
            return this;
        },
        ...responseOverrides,
    } as unknown as Response;
    const next: NextFunction = (error?: unknown) => {
        nextError = error;
        finish();
    };

    handler(req as Request, response, next);
    let timeout: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            completed,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error("route handler timed out")),
                    2000
                );
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }

    return { body, headers, nextError, response, statusCode, writes };
};

test("mounted create route authorizes before every downstream side effect", async () => {
    const handler = routeHandler("/:resourceType/:id/conversations", "post");
    const originalSelect = db.select;
    const originalInsert = db.insert;
    const originalUpdate = db.update;
    const originalSearch = hybridBookSearchService.search;
    const originalGenerate = OpenAIService.prototype.generateStreamResponse;

    try {
        for (const scenario of [
            {
                name: "unsupported",
                resourceType: "article",
                book: null,
                expectedStatus: 400,
            },
            {
                name: "missing",
                resourceType: "book",
                book: null,
                expectedStatus: 404,
            },
            {
                name: "non-owner",
                resourceType: "book",
                book: { id: "book-1", userId: "user-2" },
                expectedStatus: 403,
            },
            {
                name: "owner",
                resourceType: "book",
                book: {
                    id: "book-1",
                    userId: "user-1",
                    processingStatus: "ready",
                    processingError: null,
                    collectionName: "book_collection",
                },
                expectedStatus: 200,
            },
        ] as const) {
            const events: string[] = [];
            let conversationInserts = 0;
            let messageInserts = 0;
            let retrievals = 0;
            let modelCalls = 0;

            db.select = ((selection?: unknown) => ({
                from: (table: unknown) => {
                    if (table === Messages) {
                        events.push("historyLoad");
                        return {
                            where: () => ({ orderBy: async () => [] }),
                        };
                    }
                    assert.equal(table, Books);
                    return {
                        where: async () => {
                            events.push("bookLookup");
                            return scenario.book ? [scenario.book] : [];
                        },
                    };
                },
            })) as unknown as typeof db.select;
            db.insert = ((table: unknown) => ({
                values: (values: unknown) => {
                    if (table === Conversations) {
                        events.push("conversationInsert");
                        conversationInserts++;
                        return {
                            returning: async () => [
                                { id: "conversation-1", ...(values as object) },
                            ],
                        };
                    }
                    assert.equal(table, Messages);
                    events.push("messageInsert");
                    messageInserts++;
                    return Promise.resolve();
                },
            })) as typeof db.insert;
            db.update = (() => ({
                set: () => ({ where: async () => undefined }),
            })) as unknown as typeof db.update;
            hybridBookSearchService.search = async () => {
                events.push("retrieval");
                retrievals++;
                return [
                    {
                        id: "chunk-1",
                        chunkIndex: 0,
                        content: "context",
                        score: 1,
                        bestRank: 1,
                    },
                ];
            };
            OpenAIService.prototype.generateStreamResponse = async () => {
                events.push("model");
                modelCalls++;
                return (async function* () {
                    yield {
                        choices: [
                            {
                                delta: { content: "answer" },
                                finish_reason: "stop",
                            },
                        ],
                    } as never;
                })();
            };

            const result = await invoke(handler, {
                params: { resourceType: scenario.resourceType, id: "book-1" },
                body: {
                    message: "Question",
                },
                user: {
                    id: "user-1",
                    email: "owner@example.com",
                    name: "Owner",
                    googleId: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            assert.equal(result.nextError, undefined, scenario.name);
            assert.equal(
                result.statusCode,
                scenario.expectedStatus,
                scenario.name
            );
            if (scenario.name !== "owner") {
                assert.equal(conversationInserts, 0, scenario.name);
                assert.equal(messageInserts, 0, scenario.name);
                assert.equal(result.headers.length, 0, scenario.name);
                assert.equal(result.writes.length, 0, scenario.name);
                assert.equal(retrievals, 0, scenario.name);
                assert.equal(modelCalls, 0, scenario.name);
                continue;
            }

            assert.equal(events[0], "bookLookup");
            assert.equal(conversationInserts, 1);
            assert.equal(messageInserts, 2);
            assert.equal(result.headers.length, 3);
            assert.equal(retrievals, 1);
            assert.equal(modelCalls, 1);
            assert.deepEqual(events, [
                "bookLookup",
                "conversationInsert",
                "historyLoad",
                "messageInsert",
                "bookLookup",
                "retrieval",
                "model",
                "messageInsert",
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

test("mounted append route rejects unauthorized and mismatched scopes before side effects", async () => {
    const handler = routeHandler(
        "/:resourceType/:rid/conversations/:cid/messages",
        "post"
    );
    const originalSelect = db.select;
    const originalInsert = db.insert;
    const originalSearch = hybridBookSearchService.search;
    const originalGenerate = OpenAIService.prototype.generateStreamResponse;

    try {
        for (const scenario of [
            {
                name: "unsupported",
                resourceType: "article",
                book: null,
                conversation: null,
                expectedStatus: 400,
            },
            {
                name: "missing",
                resourceType: "book",
                book: null,
                conversation: null,
                expectedStatus: 404,
            },
            {
                name: "non-owner",
                resourceType: "book",
                book: { id: "book-1", userId: "user-2" },
                conversation: null,
                expectedStatus: 403,
            },
            {
                name: "scope mismatch",
                resourceType: "book",
                book: { id: "book-1", userId: "user-1" },
                conversation: null,
                expectedStatus: 404,
            },
        ] as const) {
            let selects = 0;
            let messageInserts = 0;
            let retrievals = 0;
            let modelCalls = 0;
            db.select = (() => ({
                from: (table: unknown) => ({
                    where: async () => {
                        selects++;
                        if (table === Books) {
                            return scenario.book ? [scenario.book] : [];
                        }
                        assert.equal(table, Conversations);
                        return scenario.conversation
                            ? [scenario.conversation]
                            : [];
                    },
                }),
            })) as unknown as typeof db.select;
            db.insert = ((table: unknown) => ({
                values: async () => {
                    assert.equal(table, Messages);
                    messageInserts++;
                },
            })) as unknown as typeof db.insert;
            hybridBookSearchService.search = async () => {
                retrievals++;
                return [];
            };
            OpenAIService.prototype.generateStreamResponse = async () => {
                modelCalls++;
                return (async function* () {})();
            };

            const result = await invoke(handler, {
                params: {
                    resourceType: scenario.resourceType,
                    rid: "book-1",
                    cid: "conversation-1",
                },
                body: {
                    message: "Question",
                },
                user: {
                    id: "user-1",
                    email: "owner@example.com",
                    name: "Owner",
                    googleId: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            assert.equal(result.nextError, undefined, scenario.name);
            assert.equal(
                result.statusCode,
                scenario.expectedStatus,
                scenario.name
            );
            assert.equal(messageInserts, 0, scenario.name);
            assert.equal(result.headers.length, 0, scenario.name);
            assert.equal(result.writes.length, 0, scenario.name);
            assert.equal(retrievals, 0, scenario.name);
            assert.equal(modelCalls, 0, scenario.name);
            assert.equal(
                selects,
                scenario.name === "scope mismatch"
                    ? 2
                    : scenario.name === "unsupported"
                      ? 0
                      : 1,
                scenario.name
            );
        }
    } finally {
        db.select = originalSelect;
        db.insert = originalInsert;
        hybridBookSearchService.search = originalSearch;
        OpenAIService.prototype.generateStreamResponse = originalGenerate;
    }
});

test("mounted append route emits an SSE error after streaming begins", async () => {
    const handler = routeHandler(
        "/:resourceType/:rid/conversations/:cid/messages",
        "post"
    );
    const originalSelect = db.select;
    const originalInsert = db.insert;
    const originalUpdate = db.update;
    const originalSearch = hybridBookSearchService.search;
    const originalGenerate = OpenAIService.prototype.generateStreamResponse;
    const originalConsoleError = console.error;
    let selects = 0;
    const insertedMessages: unknown[] = [];

    try {
        console.error = () => undefined;
        db.select = (() => ({
            from: (table: unknown) => ({
                where: () => {
                    selects++;
                    if (table === Messages) {
                        return { orderBy: async () => [] };
                    }
                    if (table === Conversations) {
                        return Promise.resolve([{ id: "conversation-1" }]);
                    }
                    assert.equal(table, Books);
                    return Promise.resolve([
                        {
                            id: "book-1",
                            userId: "user-1",
                            processingStatus: "ready",
                            processingError: null,
                            collectionName: "book_collection",
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
        hybridBookSearchService.search = async () => [
            {
                id: "chunk-1",
                chunkIndex: 0,
                content: "context",
                score: 1,
                bestRank: 1,
            },
        ];
        OpenAIService.prototype.generateStreamResponse = async () => {
            return (async function* () {
                yield {
                    choices: [
                        {
                            delta: { content: "partial" },
                            finish_reason: null,
                        },
                    ],
                } as never;
                throw new Error("model unavailable");
            })();
        };

        const result = await invoke(handler, {
            params: {
                resourceType: "book",
                rid: "book-1",
                cid: "conversation-1",
            },
            body: {
                message: "Question",
            },
            user: {
                id: "user-1",
                email: "owner@example.com",
                name: "Owner",
                googleId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        });

        assert.equal(result.nextError, undefined);
        assert.equal(selects, 4);
        assert.deepEqual(result.headers, [
            ["Content-Type", "text/event-stream"],
            ["Cache-Control", "no-cache"],
            ["Connection", "keep-alive"],
        ]);
        assert.deepEqual(result.writes, [
            `data: ${JSON.stringify({ content: "partial" })}\n\n`,
            `data: ${JSON.stringify({ error: "An error occurred" })}\n\n`,
        ]);
        assert.equal(result.response.headersSent, true);
        assert.equal(result.response.writableEnded, true);
        assert.deepEqual(insertedMessages, [
            {
                conversationId: "conversation-1",
                role: "user",
                content: "Question",
            },
        ]);
    } finally {
        db.select = originalSelect;
        db.insert = originalInsert;
        db.update = originalUpdate;
        hybridBookSearchService.search = originalSearch;
        OpenAIService.prototype.generateStreamResponse = originalGenerate;
        console.error = originalConsoleError;
    }
});

test("pre-stream create and append failures reach terminal middleware", async () => {
    const createHandler = routeHandler(
        "/:resourceType/:id/conversations",
        "post"
    );
    const appendHandler = routeHandler(
        "/:resourceType/:rid/conversations/:cid/messages",
        "post"
    );
    const originalSelect = db.select;
    const originalConsoleError = console.error;
    const failure = new Error("database unavailable");

    try {
        console.error = () => undefined;
        db.select = (() => ({
            from: () => ({ where: async () => Promise.reject(failure) }),
        })) as unknown as typeof db.select;
        const user = {
            id: "user-1",
            email: "owner@example.com",
            name: "Owner",
            googleId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const body = {
            message: "Question",
        };
        const createResult = await invoke(createHandler, {
            params: { resourceType: "book", id: "book-1" },
            body,
            user,
        });

        let selectCount = 0;
        db.select = (() => ({
            from: () => ({
                where: async () => {
                    selectCount++;
                    if (selectCount === 1) {
                        return [{ id: "book-1", userId: "user-1" }];
                    }
                    throw failure;
                },
            }),
        })) as unknown as typeof db.select;
        const appendResult = await invoke(appendHandler, {
            params: {
                resourceType: "book",
                rid: "book-1",
                cid: "conversation-1",
            },
            body,
            user,
        });

        for (const result of [createResult, appendResult]) {
            assert.equal(result.nextError, failure);
            assert.equal(result.response.headersSent, false);
            assert.equal(result.writes.length, 0);
            assert.equal(result.statusCode, 200);
        }
        assert.equal(
            selectCount,
            2,
            "append must authorize before scope lookup"
        );
    } finally {
        db.select = originalSelect;
        console.error = originalConsoleError;
    }
});
