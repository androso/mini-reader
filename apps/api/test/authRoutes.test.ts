import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";

process.env.JWT_SECRET ??= "test-jwt-secret";
process.env.GOOGLE_CLIENT_ID ??= "reader-web.apps.googleusercontent.com";

test("authentication responses expose the public user projection and never passwordHash, googleId, or JWT tokens", async () => {
    const { authResponse } = await import("../src/routes/Auth.routes");
    const fullUser = {
        id: "reader-1",
        email: "reader@example.com",
        name: "Reader One",
        image: null,
        username: "reader_one",
        googleId: "google-123",
        passwordHash: "scrypt$v1$...",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const res = authResponse(fullUser);
    assert.deepEqual(res, {
        user: {
            id: "reader-1",
            email: "reader@example.com",
            name: "Reader One",
            image: null,
            username: "reader_one",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
    });
    assert.equal("passwordHash" in (res.user as any), false);
    assert.equal("googleId" in (res.user as any), false);
    assert.equal("token" in res, false);
});

test("logout clears both session cookies and returns 204", async () => {
    const { logout } = await import("../src/routes/Auth.routes");
    const cleared: string[] = [];
    let statusCode: number | undefined;
    let ended = false;
    const response = {
        clearCookie(name: string) {
            cleared.push(name);
            return response;
        },
        status(code: number) {
            statusCode = code;
            return response;
        },
        end() {
            ended = true;
            return response;
        },
    } as unknown as Response;

    logout({} as Request, response);

    assert.deepEqual(cleared, ["__Host-reader_session", "reader_session"]);
    assert.equal(statusCode, 204);
    assert.equal(ended, true);
});
test("createSignupHandler sets auth cookie and returns 201 with public user", async () => {
    const { createSignupHandler } = await import("../src/routes/Auth.routes");
    const mockUser = {
        id: "new-user-id",
        email: "new@example.com",
        name: "New_User",
        username: "new_user",
        image: null,
        googleId: null,
        passwordHash: "scrypt$v1$...",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
    };

    const mockRepo = {
        async findByEmail() {
            return undefined;
        },
        async findByUsername() {
            return undefined;
        },
        async createUser() {
            return mockUser;
        },
    };

    const handler = createSignupHandler(mockRepo as any);
    let statusCode: number | undefined;
    let jsonBody: any;
    const headers: Record<string, string> = {};

    const req = {
        body: {
            username: "New_User",
            email: "new@example.com",
            password: "password123",
        },
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    const cookieCalls: any[] = [];
    await new Promise<void>((resolve, reject) => {
        const res = {
            status(code: number) {
                statusCode = code;
                return res;
            },
            json(body: any) {
                jsonBody = body;
                resolve();
                return res;
            },
            cookie(name: string, value: string, options: any) {
                cookieCalls.push({ name, value, options });
                return res;
            },
            setHeader(name: string, value: string) {
                headers[name] = value;
                return res;
            },
        } as unknown as Response;
        handler(req, res, (err) => (err ? reject(err) : resolve()));
    });

    assert.equal(statusCode, 201);
    assert.deepEqual(jsonBody, {
        user: {
            id: "new-user-id",
            email: "new@example.com",
            name: "New_User",
            username: "new_user",
            image: null,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
        },
    });
    assert.ok(cookieCalls.length > 0);
});

test("createLoginHandler sets auth cookie and returns 200 with public user", async () => {
    const { createLoginHandler } = await import("../src/routes/Auth.routes");
    const { hashPassword: hp } = await import("../src/services/AuthService");
    const passwordHash = await hp("password123");

    const mockUser = {
        id: "login-user-id",
        email: "login@example.com",
        name: "Login User",
        username: "login_user",
        image: null,
        googleId: null,
        passwordHash,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
    };

    const mockRepo = {
        async findByEmail(email: string) {
            return email === "login@example.com" ? mockUser : undefined;
        },
        async findByUsername() {
            return undefined;
        },
        async createUser() {
            throw new Error("Not implemented");
        },
    };

    const handler = createLoginHandler(mockRepo as any);
    let statusCode: number | undefined;
    let jsonBody: any;
    const headers: Record<string, string> = {};

    const req = {
        body: { email: "login@example.com", password: "password123" },
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    const cookieCalls: any[] = [];
    await new Promise<void>((resolve, reject) => {
        const res = {
            status(code: number) {
                statusCode = code;
                return res;
            },
            json(body: any) {
                jsonBody = body;
                resolve();
                return res;
            },
            cookie(name: string, value: string, options: any) {
                cookieCalls.push({ name, value, options });
                return res;
            },
            setHeader(name: string, value: string) {
                headers[name] = value;
                return res;
            },
        } as unknown as Response;
        handler(req, res, (err) => (err ? reject(err) : resolve()));
    });

    assert.equal(statusCode, 200);
    assert.deepEqual(jsonBody, {
        user: {
            id: "login-user-id",
            email: "login@example.com",
            name: "Login User",
            username: "login_user",
            image: null,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
        },
    });
    assert.ok(cookieCalls.length > 0);
});
