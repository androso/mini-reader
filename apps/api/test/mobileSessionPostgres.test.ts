import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";
import { withHttpServer } from "./support/http";

type MobileSessionBody = {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresIn: number;
    refreshTokenExpiresAt: string;
    user: {
        id: string;
        email: string;
        name: string;
        username: string | null;
        image: string | null;
    };
};

const unauthorizedRefresh = {
    message: "Refresh token is invalid, expired, or already used",
};

const jsonHeaders = { "Content-Type": "application/json" };

type Queryable = {
    query: (
        text: string,
        values?: unknown[]
    ) => Promise<{ rows: Array<Record<string, string>> }>;
};

const postJson = async (url: string, body: unknown) =>
    fetch(url, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
    });

const signup = async (
    baseUrl: string,
    email: string,
    username: string
): Promise<MobileSessionBody> => {
    const response = await postJson(`${baseUrl}/api/auth/mobile/signup`, {
        email,
        username,
        password: "password123",
    });
    assert.equal(response.status, 201, email);
    return (await response.json()) as MobileSessionBody;
};

const refresh = async (baseUrl: string, refreshToken: string) =>
    postJson(`${baseUrl}/api/auth/mobile/refresh`, { refreshToken });

const assertUnauthorizedRefresh = async (response: Response) => {
    assert.equal(response.status, 401);
    const body = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(body, unauthorizedRefresh);
    assert.equal("accessToken" in body, false);
    assert.equal("refreshToken" in body, false);
};

const activeSessionCount = async (database: Queryable, userId: string) => {
    const result = await database.query(
        `SELECT count(*)::text AS active_count
         FROM mobile_sessions
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
    );
    return result.rows[0]!.active_count;
};

const sessionCount = async (database: Queryable, userId: string) => {
    const result = await database.query(
        `SELECT count(*)::text AS count
         FROM mobile_sessions
         WHERE user_id = $1`,
        [userId]
    );
    return result.rows[0]!.count;
};

test(
    "mobile signup, bearer user, refresh rotation, replay revoke, and logout",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_mobile_session",
            { migrate: true },
            async ({ url, client: database }) => {
                let pool: (typeof import("../src/db"))["pool"] | undefined;

                try {
                    Object.assign(process.env, {
                        NODE_ENV: "test",
                        CODEX_OAUTH_ENABLED: "false",
                        JWT_SECRET: "mobile-session-postgres-secret",
                        GOOGLE_CLIENT_ID:
                            "reader-mobile-session.apps.googleusercontent.com",
                        DATABASE_URL: url,
                    });

                    const [{ default: authRoutes }, { default: userRoutes }] =
                        await Promise.all([
                            import("../src/routes/Auth.routes"),
                            import("../src/routes/User.routes"),
                        ]);
                    ({ pool } = await import("../src/db"));

                    const app = express();
                    app.use(express.json());
                    app.use("/api/auth", authRoutes);
                    app.use("/api/user", userRoutes);

                    await withHttpServer(app, async (baseUrl) => {
                        const initial = await signup(
                            baseUrl,
                            "mobile@example.test",
                            "mobile_user"
                        );
                        assert.equal(typeof initial.accessToken, "string");
                        assert.equal(typeof initial.refreshToken, "string");
                        assert.equal(initial.accessTokenExpiresIn, 15 * 60);
                        assert.equal(initial.user.email, "mobile@example.test");
                        assert.equal(
                            "passwordHash" in (initial.user as object),
                            false
                        );
                        assert.equal(
                            await activeSessionCount(database, initial.user.id),
                            "1"
                        );

                        const meResponse = await fetch(`${baseUrl}/api/user`, {
                            headers: {
                                Authorization: `Bearer ${initial.accessToken}`,
                            },
                        });
                        assert.equal(meResponse.status, 200);
                        assert.deepEqual(await meResponse.json(), {
                            user: initial.user,
                        });

                        const refreshResponse = await refresh(
                            baseUrl,
                            initial.refreshToken
                        );
                        assert.equal(refreshResponse.status, 200);
                        const rotated =
                            (await refreshResponse.json()) as MobileSessionBody;
                        assert.notEqual(
                            rotated.refreshToken,
                            initial.refreshToken
                        );
                        assert.notEqual(
                            rotated.accessToken,
                            initial.accessToken
                        );
                        assert.equal(rotated.user.id, initial.user.id);
                        assert.equal(
                            await activeSessionCount(database, initial.user.id),
                            "1"
                        );

                        const staleRefresh = await refresh(
                            baseUrl,
                            initial.refreshToken
                        );
                        await assertUnauthorizedRefresh(staleRefresh);
                        assert.equal(
                            await activeSessionCount(database, initial.user.id),
                            "0"
                        );

                        const replacementRefresh = await refresh(
                            baseUrl,
                            rotated.refreshToken
                        );
                        await assertUnauthorizedRefresh(replacementRefresh);
                        assert.equal(
                            await activeSessionCount(database, initial.user.id),
                            "0"
                        );

                        const malformedUser = await signup(
                            baseUrl,
                            "mobile-malformed@example.test",
                            "mobile_malformed"
                        );
                        const malformedBefore = await sessionCount(
                            database,
                            malformedUser.user.id
                        );
                        const malformedRefresh = await refresh(
                            baseUrl,
                            "not-a-token"
                        );
                        await assertUnauthorizedRefresh(malformedRefresh);
                        assert.equal(
                            await sessionCount(database, malformedUser.user.id),
                            malformedBefore
                        );
                        assert.equal(
                            await activeSessionCount(
                                database,
                                malformedUser.user.id
                            ),
                            "1"
                        );

                        const wrongSecretUser = await signup(
                            baseUrl,
                            "mobile-wrong@example.test",
                            "mobile_wrong"
                        );
                        const [sessionId] =
                            wrongSecretUser.refreshToken.split(".");
                        const wrongSecretRefresh = await refresh(
                            baseUrl,
                            `${sessionId}.${"b".repeat(43)}`
                        );
                        await assertUnauthorizedRefresh(wrongSecretRefresh);
                        assert.equal(
                            await activeSessionCount(
                                database,
                                wrongSecretUser.user.id
                            ),
                            "0"
                        );

                        const expiredUser = await signup(
                            baseUrl,
                            "mobile-expired@example.test",
                            "mobile_expired"
                        );
                        const expiredSessionId =
                            expiredUser.refreshToken.split(".")[0]!;
                        await database.query(
                            `UPDATE mobile_sessions
                             SET expires_at = now() - interval '1 minute'
                             WHERE id = $1`,
                            [expiredSessionId]
                        );
                        const expiredBefore = await sessionCount(
                            database,
                            expiredUser.user.id
                        );
                        const expiredRefresh = await refresh(
                            baseUrl,
                            expiredUser.refreshToken
                        );
                        await assertUnauthorizedRefresh(expiredRefresh);
                        assert.equal(
                            await sessionCount(database, expiredUser.user.id),
                            expiredBefore
                        );
                        assert.equal(
                            await activeSessionCount(
                                database,
                                expiredUser.user.id
                            ),
                            "0"
                        );

                        const logoutUser = await signup(
                            baseUrl,
                            "mobile-logout@example.test",
                            "mobile_logout"
                        );
                        const logoutResponse = await postJson(
                            `${baseUrl}/api/auth/mobile/logout`,
                            { refreshToken: logoutUser.refreshToken }
                        );
                        assert.equal(logoutResponse.status, 204);

                        const afterLogoutUser = await fetch(
                            `${baseUrl}/api/user`,
                            {
                                headers: {
                                    Authorization: `Bearer ${logoutUser.accessToken}`,
                                },
                            }
                        );
                        assert.equal(afterLogoutUser.status, 401);
                        assert.deepEqual(await afterLogoutUser.json(), {
                            message: "Invalid or expired bearer token",
                        });

                        const afterLogoutRefresh = await refresh(
                            baseUrl,
                            logoutUser.refreshToken
                        );
                        await assertUnauthorizedRefresh(afterLogoutRefresh);

                        const liveUser = await signup(
                            baseUrl,
                            "mobile-live@example.test",
                            "mobile_live"
                        );
                        const wrongSecretJwt = jwt.sign(
                            {
                                userId: liveUser.user.id,
                                sessionId: liveUser.refreshToken.split(".")[0],
                                tokenType: "mobile-access",
                            },
                            "wrong-secret",
                            { expiresIn: 60 }
                        );
                        const wrongSecretAccess = await fetch(
                            `${baseUrl}/api/user`,
                            {
                                headers: {
                                    Authorization: `Bearer ${wrongSecretJwt}`,
                                },
                            }
                        );
                        assert.equal(wrongSecretAccess.status, 401);
                        assert.deepEqual(await wrongSecretAccess.json(), {
                            message: "Invalid or expired bearer token",
                        });
                        assert.equal(
                            await activeSessionCount(
                                database,
                                liveUser.user.id
                            ),
                            "1"
                        );
                    });
                } finally {
                    if (pool) await pool.end();
                }
            }
        );
    }
);
