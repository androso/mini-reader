import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";

const unsignedJwt = (payload: Record<string, unknown>) =>
    [
        Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
        Buffer.from(JSON.stringify(payload)).toString("base64url"),
        "sig",
    ].join(".");

const jsonResponse = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {}
) => {
    const encoded = Buffer.from(JSON.stringify(body));
    return new Response(encoded, {
        status,
        headers: {
            "content-type": "application/json",
            "content-length": String(encoded.byteLength),
            ...headers,
        },
    });
};

const streamResponse = (status: number, chunks: Uint8Array[]) => {
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (index >= chunks.length) {
                controller.close();
                return;
            }
            controller.enqueue(chunks[index]);
            index += 1;
        },
    });
    return new Response(stream, { status });
};

const callbackUrl = (code: string, state: string) =>
    `http://localhost:1455/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

test(
    "CodexOAuthService postgres covers authorize, callback, refresh, and token errors",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_codex_oauth",
            { migrate: true },
            async ({ url, client }) => {
                const previous = {
                    databaseUrl: process.env.DATABASE_URL,
                    enabled: process.env.CODEX_OAUTH_ENABLED,
                    key: process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY,
                };
                let pool: (typeof import("../src/db"))["pool"] | undefined;

                try {
                    process.env.DATABASE_URL = url;
                    process.env.CODEX_OAUTH_ENABLED = "true";
                    process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY =
                        randomBytes(32).toString("base64");

                    const userId = "10000000-0000-4000-8000-0000000000c1";
                    await client.query(
                        `INSERT INTO "users" ("id", "email", "name") VALUES ($1, 'codex@example.test', 'Codex User')`,
                        [userId]
                    );

                    ({ pool } = await import("../src/db"));
                    const { CodexOAuthError, CodexOAuthService } = await import(
                        "../src/services/CodexOAuthService"
                    );

                    const idToken = unsignedJwt({
                        email: "codex@example.test",
                        "https://api.openai.com/auth": {
                            chatgpt_account_id: "acct_1",
                            chatgpt_plan_type: "plus",
                        },
                    });

                    let refreshPhase = 0;
                    let tokenHandler: (
                        input: RequestInfo | URL,
                        init?: RequestInit
                    ) => Promise<Response> = async (_input, init) => {
                        const body = String(init?.body ?? "");
                        if (body.includes("grant_type=authorization_code")) {
                            return jsonResponse(200, {
                                id_token: idToken,
                                access_token: "access-1",
                                refresh_token: "refresh-1",
                                expires_in: 3600,
                            });
                        }
                        if (body.includes("grant_type=refresh_token")) {
                            refreshPhase += 1;
                            if (refreshPhase === 1) {
                                return jsonResponse(200, {
                                    id_token: idToken,
                                    access_token: "access-2",
                                    refresh_token: "refresh-2",
                                    expires_in: 3600,
                                });
                            }
                            return jsonResponse(400, {
                                error: "invalid_grant",
                            });
                        }
                        return jsonResponse(500, { error: "boom" });
                    };

                    const service = new CodexOAuthService((input, init) =>
                        tokenHandler(input, init)
                    );

                    assert.equal(
                        await service.hasUsableCredentials(userId),
                        false
                    );

                    await assert.rejects(
                        () =>
                            service.completeAuthorization(
                                userId,
                                callbackUrl("x", "y")
                            ),
                        (error: unknown) =>
                            error instanceof CodexOAuthError &&
                            error.message === "No pending Codex authorization"
                    );

                    const started = await service.startAuthorization(userId);
                    assert.match(started.authorizationUrl, /code_challenge=/);
                    assert.match(
                        started.authorizationUrl,
                        /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/
                    );
                    assert.ok(started.expiresAt.getTime() > Date.now());

                    const pending = await client.query<{
                        pending_state: string;
                        pending_verifier_encrypted: string;
                        pending_expires_at: Date;
                    }>(
                        `SELECT pending_state, pending_verifier_encrypted, pending_expires_at
                         FROM codex_credentials WHERE user_id = $1`,
                        [userId]
                    );
                    const state = pending.rows[0]?.pending_state;
                    assert.ok(state);
                    assert.ok(pending.rows[0]?.pending_verifier_encrypted);
                    assert.ok(pending.rows[0]?.pending_expires_at);

                    await assert.rejects(
                        () =>
                            service.completeAuthorization(userId, "not a url"),
                        (error: unknown) =>
                            error instanceof CodexOAuthError &&
                            error.message === "Invalid Codex callback URL"
                    );
                    await assert.rejects(
                        () =>
                            service.completeAuthorization(
                                userId,
                                "https://evil.example/auth/callback?code=1&state=1"
                            ),
                        (error: unknown) =>
                            error instanceof CodexOAuthError &&
                            error.message === "Invalid Codex callback URL"
                    );
                    await assert.rejects(
                        () =>
                            service.completeAuthorization(
                                userId,
                                `http://localhost:1455/auth/callback?code=1&state=${state}&state=extra`
                            ),
                        (error: unknown) =>
                            error instanceof CodexOAuthError &&
                            error.message === "Invalid Codex callback URL"
                    );
                    await assert.rejects(
                        () =>
                            service.completeAuthorization(
                                userId,
                                callbackUrl("1", "mismatch")
                            ),
                        (error: unknown) =>
                            error instanceof CodexOAuthError &&
                            error.message ===
                                "Codex authorization state mismatch"
                    );

                    await client.query(
                        `UPDATE codex_credentials SET pending_expires_at = now() - interval '1 minute' WHERE user_id = $1`,
                        [userId]
                    );
                    await assert.rejects(
                        () =>
                            service.completeAuthorization(
                                userId,
                                callbackUrl("1", state)
                            ),
                        (error: unknown) =>
                            error instanceof CodexOAuthError &&
                            error.message === "Codex authorization expired"
                    );
                    const cleared = await client.query<{
                        pending_state: string | null;
                        pending_verifier_encrypted: string | null;
                        pending_expires_at: Date | null;
                    }>(
                        `SELECT pending_state, pending_verifier_encrypted, pending_expires_at
                         FROM codex_credentials WHERE user_id = $1`,
                        [userId]
                    );
                    assert.equal(cleared.rows[0]?.pending_state, null);
                    assert.equal(
                        cleared.rows[0]?.pending_verifier_encrypted,
                        null
                    );
                    assert.equal(cleared.rows[0]?.pending_expires_at, null);

                    const restart = await service.startAuthorization(userId);
                    const pending2 = await client.query<{
                        pending_state: string;
                    }>(
                        `SELECT pending_state FROM codex_credentials WHERE user_id = $1`,
                        [userId]
                    );
                    const state2 = pending2.rows[0]?.pending_state;
                    assert.ok(state2);
                    assert.ok(restart.expiresAt.getTime() > Date.now());

                    const tokenErrorCases: Array<{
                        name: string;
                        handler: typeof tokenHandler;
                        message: string;
                    }> = [
                        {
                            name: "empty body",
                            handler: async () =>
                                new Response(null, {
                                    status: 200,
                                    headers: {
                                        "content-type": "application/json",
                                    },
                                }),
                            message: "Codex token response was empty",
                        },
                        {
                            name: "too-large content-length",
                            handler: async () =>
                                jsonResponse(
                                    200,
                                    { ok: true },
                                    {
                                        "content-length": String(
                                            2 * 1024 * 1024
                                        ),
                                    }
                                ),
                            message: "Codex token response was too large",
                        },
                        {
                            name: "invalid JSON",
                            handler: async () =>
                                streamResponse(200, [Buffer.from("not-json")]),
                            message: "Codex token response was invalid",
                        },
                        {
                            name: "incomplete token JSON",
                            handler: async () =>
                                jsonResponse(200, { access_token: "x" }),
                            message: "Codex token response was incomplete",
                        },
                        {
                            name: "network failure",
                            handler: async () => {
                                throw new Error("socket hang up");
                            },
                            message: "Codex token request failed",
                        },
                        {
                            name: "non-ok response",
                            handler: async () =>
                                jsonResponse(503, { error: "unavailable" }),
                            message: "Codex token service is unavailable",
                        },
                    ];

                    for (const tokenError of tokenErrorCases) {
                        tokenHandler = tokenError.handler;
                        await assert.rejects(
                            () =>
                                service.completeAuthorization(
                                    userId,
                                    callbackUrl("auth-code", state2)
                                ),
                            (error: unknown) =>
                                error instanceof CodexOAuthError &&
                                error.message === tokenError.message,
                            tokenError.name
                        );
                    }

                    tokenHandler = async (_input, init) => {
                        const body = String(init?.body ?? "");
                        if (body.includes("grant_type=authorization_code")) {
                            return jsonResponse(200, {
                                id_token: idToken,
                                access_token: "access-1",
                                refresh_token: "refresh-1",
                                expires_in: 3600,
                            });
                        }
                        if (body.includes("grant_type=refresh_token")) {
                            refreshPhase += 1;
                            if (refreshPhase === 1) {
                                return jsonResponse(200, {
                                    id_token: idToken,
                                    access_token: "access-2",
                                    refresh_token: "refresh-2",
                                    expires_in: 3600,
                                });
                            }
                            return jsonResponse(400, {
                                error: "invalid_grant",
                            });
                        }
                        return jsonResponse(500, { error: "boom" });
                    };

                    const metadata = await service.completeAuthorization(
                        userId,
                        callbackUrl("auth-code", state2)
                    );
                    assert.deepEqual(metadata, {
                        accountId: "acct_1",
                        email: "codex@example.test",
                        planType: "plus",
                    });
                    assert.equal(
                        await service.hasUsableCredentials(userId),
                        true
                    );

                    const stored = await client.query<{
                        access_token_encrypted: string | null;
                        refresh_token_encrypted: string | null;
                        account_id: string | null;
                        pending_state: string | null;
                        reauth_required: boolean;
                    }>(
                        `SELECT access_token_encrypted, refresh_token_encrypted, account_id,
                                pending_state, reauth_required
                         FROM codex_credentials WHERE user_id = $1`,
                        [userId]
                    );
                    assert.ok(stored.rows[0]?.access_token_encrypted);
                    assert.ok(stored.rows[0]?.refresh_token_encrypted);
                    assert.equal(stored.rows[0]?.account_id, "acct_1");
                    assert.equal(stored.rows[0]?.pending_state, null);
                    assert.equal(stored.rows[0]?.reauth_required, false);

                    const valid = await service.getValidAccessToken(userId);
                    assert.deepEqual(valid, {
                        accessToken: "access-1",
                        accountId: "acct_1",
                    });

                    await client.query(
                        `UPDATE codex_credentials SET token_expires_at = now() - interval '1 minute' WHERE user_id = $1`,
                        [userId]
                    );
                    const refreshed = await service.getValidAccessToken(userId);
                    assert.deepEqual(refreshed, {
                        accessToken: "access-2",
                        accountId: "acct_1",
                    });

                    await client.query(
                        `UPDATE codex_credentials SET token_expires_at = now() + interval '30 seconds' WHERE user_id = $1`,
                        [userId]
                    );
                    await assert.rejects(
                        () => service.getValidAccessToken(userId),
                        (error: unknown) =>
                            error instanceof CodexOAuthError &&
                            error.status === 400 &&
                            error.retryable === false &&
                            error.message ===
                                "Codex authorization is no longer valid"
                    );
                    const reauth = await client.query<{
                        reauth_required: boolean;
                        access_token_encrypted: string | null;
                        refresh_token_encrypted: string | null;
                    }>(
                        `SELECT reauth_required, access_token_encrypted, refresh_token_encrypted
                         FROM codex_credentials WHERE user_id = $1`,
                        [userId]
                    );
                    assert.equal(reauth.rows[0]?.reauth_required, true);
                    assert.equal(reauth.rows[0]?.access_token_encrypted, null);
                    assert.equal(reauth.rows[0]?.refresh_token_encrypted, null);
                    assert.equal(
                        await service.hasUsableCredentials(userId),
                        false
                    );

                    await assert.rejects(
                        () => service.getValidAccessToken(userId),
                        (error: unknown) =>
                            error instanceof CodexOAuthError &&
                            error.message === "Codex account must be connected"
                    );
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
