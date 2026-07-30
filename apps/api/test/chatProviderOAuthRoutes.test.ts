import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";

process.env.JWT_SECRET ??= "chat-provider-oauth-routes-test-secret";
process.env.GOOGLE_CLIENT_ID ??=
    "reader-chat-provider-oauth.apps.googleusercontent.com";
process.env.CODEX_OAUTH_ENABLED = "true";
process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY =
    randomBytes(32).toString("base64");

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

const findRoute = (
    router: { stack: RouteLayer[] },
    path: string,
    method: "get" | "post" | "delete"
) => {
    const layer = router.stack.find(
        (candidate) =>
            candidate.route?.path === path && candidate.route.methods[method]
    );
    assert.ok(layer?.route, `${method.toUpperCase()} ${path}`);
    return layer.route;
};

test(
    "ChatProvider Codex OAuth routes authorize, validate complete, delete, and sendOAuthError",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_chat_provider_oauth",
            { migrate: true },
            async ({ url, client }) => {
                const previous = {
                    databaseUrl: process.env.DATABASE_URL,
                    enabled: process.env.CODEX_OAUTH_ENABLED,
                    key: process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY,
                    jwt: process.env.JWT_SECRET,
                    google: process.env.GOOGLE_CLIENT_ID,
                };
                let pool: (typeof import("../src/db"))["pool"] | undefined;

                try {
                    process.env.DATABASE_URL = url;
                    process.env.CODEX_OAUTH_ENABLED = "true";
                    process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY =
                        previous.key ?? randomBytes(32).toString("base64");
                    process.env.JWT_SECRET =
                        previous.jwt ??
                        "chat-provider-oauth-routes-test-secret";
                    process.env.GOOGLE_CLIENT_ID =
                        previous.google ??
                        "reader-chat-provider-oauth.apps.googleusercontent.com";

                    const userId = "10000000-0000-4000-8000-0000000000c2";
                    await client.query(
                        `INSERT INTO "users" ("id", "email", "name") VALUES ($1, 'oauth-routes@example.test', 'OAuth Routes')`,
                        [userId]
                    );

                    ({ pool } = await import("../src/db"));
                    const chatProviderRouter = (
                        await import("../src/routes/ChatProvider.routes")
                    ).default as unknown as { stack: RouteLayer[] };

                    const userReq = {
                        user: {
                            id: userId,
                            email: "oauth-routes@example.test",
                            passwordHash: null,
                            googleId: null,
                        },
                    } as Partial<Request>;

                    const authorizeRoute = findRoute(
                        chatProviderRouter,
                        "/codex/authorize",
                        "post"
                    );
                    const authorize = await invoke(
                        authorizeRoute.stack.at(-1)!.handle,
                        userReq
                    );
                    assert.equal(authorize.statusCode, 200);
                    const authorizeBody = authorize.body as {
                        authorizationUrl: string;
                        expiresAt: string;
                    };
                    assert.match(
                        authorizeBody.authorizationUrl,
                        /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/
                    );
                    assert.match(
                        authorizeBody.authorizationUrl,
                        /code_challenge=/
                    );
                    assert.ok(
                        Date.parse(authorizeBody.expiresAt) > Date.now() - 1000
                    );

                    const pending = await client.query<{
                        pending_state: string;
                    }>(
                        `SELECT pending_state FROM codex_credentials WHERE user_id = $1`,
                        [userId]
                    );
                    assert.ok(pending.rows[0]?.pending_state);

                    const completeRoute = findRoute(
                        chatProviderRouter,
                        "/codex/complete",
                        "post"
                    );
                    const badBody = await invoke(
                        completeRoute.stack.at(-1)!.handle,
                        {
                            ...userReq,
                            body: {},
                        }
                    );
                    assert.equal(badBody.statusCode, 400);
                    assert.deepEqual(badBody.body, {
                        error: "redirectUrl is required",
                    });

                    const oauthError = await invoke(
                        completeRoute.stack.at(-1)!.handle,
                        {
                            ...userReq,
                            body: { redirectUrl: "not-a-valid-url" },
                        }
                    );
                    assert.equal(oauthError.statusCode, 400);
                    assert.deepEqual(oauthError.body, {
                        error: "Invalid Codex callback URL",
                    });

                    const deleteRoute = findRoute(
                        chatProviderRouter,
                        "/codex",
                        "delete"
                    );
                    const deleted = await invoke(
                        deleteRoute.stack.at(-1)!.handle,
                        userReq
                    );
                    assert.equal(deleted.statusCode, 204);
                    assert.equal(deleted.body, undefined);

                    const remaining = await client.query<{ count: string }>(
                        `SELECT count(*)::text AS count FROM codex_credentials WHERE user_id = $1`,
                        [userId]
                    );
                    assert.equal(remaining.rows[0]?.count, "0");
                } finally {
                    if (pool) await pool.end();
                    const restoreEnv = (
                        name: string,
                        value: string | undefined
                    ) => {
                        if (value === undefined) delete process.env[name];
                        else process.env[name] = value;
                    };
                    restoreEnv("DATABASE_URL", previous.databaseUrl);
                    restoreEnv("CODEX_OAUTH_ENABLED", previous.enabled);
                    restoreEnv("CODEX_CREDENTIAL_ENCRYPTION_KEY", previous.key);
                }
            }
        );
    }
);
