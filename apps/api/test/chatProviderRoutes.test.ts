import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";

process.env.JWT_SECRET ??= "chat-provider-routes-test-secret";
process.env.GOOGLE_CLIENT_ID ??= "reader-web.apps.googleusercontent.com";
process.env.CODEX_OAUTH_ENABLED = "false";

const { authenticate } =
    require("../src/middleware/auth") as typeof import("../src/middleware/auth");
const { OPENAI_CHAT_MODEL, OPENAI_CHAT_MODELS } =
    require("../src/services/OpenAIServices") as typeof import("../src/services/OpenAIServices");
const chatProviderRouter = (
    require("../src/routes/ChatProvider.routes") as {
        default: typeof import("../src/routes/ChatProvider.routes").default;
    }
).default;

type RouteLayer = {
    route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
    };
};

const invoke = async (handler: RequestHandler, req: Partial<Request>) => {
    let statusCode = 200;
    let body: unknown;
    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
        settle = resolve;
    });
    const response = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        json(payload: unknown) {
            body = payload;
            settle();
            return this;
        },
        end() {
            settle();
            return this;
        },
    } as unknown as Response;

    handler(req as Request, response, ((error?: unknown) => {
        if (error) throw error;
        settle();
    }) as NextFunction);
    await done;
    return { statusCode, body };
};

const findRoute = (path: string, method: "get" | "post" | "delete") => {
    const stack = (chatProviderRouter as unknown as { stack: RouteLayer[] })
        .stack;
    const layer = stack.find(
        (candidate) =>
            candidate.route?.path === path && candidate.route.methods[method]
    );
    assert.ok(layer?.route, `${method.toUpperCase()} ${path}`);
    return layer.route;
};

test("chat provider routes require authenticate first", () => {
    for (const [path, method] of [
        ["/", "get"],
        ["/codex/authorize", "post"],
        ["/codex/complete", "post"],
        ["/codex", "delete"],
    ] as const) {
        const route = findRoute(path, method);
        assert.equal(route.stack[0].handle, authenticate, `${method} ${path}`);
    }
});

test("GET /api/chat-provider returns a public status without credential secrets", async () => {
    const route = findRoute("/", "get");
    const result = await invoke(route.stack.at(-1)!.handle, {
        user: {
            id: "10000000-0000-4000-8000-000000000001",
            email: "reader@example.com",
            passwordHash: "secret",
            googleId: "google-123",
        },
    } as Partial<Request>);

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
        codexAvailable: false,
        provider: "openai",
        connected: false,
        reauthRequired: false,
        account: null,
        models: [...OPENAI_CHAT_MODELS],
        defaultModel: OPENAI_CHAT_MODEL,
    });
    const serialized = JSON.stringify(result.body);
    assert.equal(serialized.includes("accessTokenEncrypted"), false);
    assert.equal(serialized.includes("refreshTokenEncrypted"), false);
    assert.equal(serialized.includes("passwordHash"), false);
    assert.equal(serialized.includes("googleId"), false);
});

test("GET /api/chat-provider authenticate rejects missing sessions", async () => {
    const result = await invoke(authenticate, {
        headers: {},
        get() {
            return undefined;
        },
    } as Partial<Request>);

    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.body, { message: "No session provided" });
});

test("POST /codex/authorize returns 503 when Codex OAuth is disabled", async () => {
    const route = findRoute("/codex/authorize", "post");
    const result = await invoke(route.stack.at(-1)!.handle, {
        user: {
            id: "10000000-0000-4000-8000-000000000001",
            email: "reader@example.com",
            passwordHash: "secret",
            googleId: "google-123",
        },
    } as Partial<Request>);

    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.body, { error: "Codex OAuth is not enabled" });
});
