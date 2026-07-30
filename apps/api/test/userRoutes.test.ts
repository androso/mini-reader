import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";

process.env.JWT_SECRET ??= "user-routes-test-secret";
process.env.GOOGLE_CLIENT_ID ??= "reader-web.apps.googleusercontent.com";

const { authenticate } =
    require("../src/middleware/auth") as typeof import("../src/middleware/auth");
const { authResponse } =
    require("../src/routes/Auth.routes") as typeof import("../src/routes/Auth.routes");
const userRouter = (
    require("../src/routes/User.routes") as {
        default: typeof import("../src/routes/User.routes").default;
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

const getRoute = () => {
    const stack = (userRouter as unknown as { stack: RouteLayer[] }).stack;
    const layer = stack.find(
        (candidate) =>
            candidate.route?.path === "/" && candidate.route.methods.get
    );
    assert.ok(layer?.route);
    return layer.route;
};

test("GET /api/user requires authenticate before returning the public user", () => {
    const route = getRoute();
    assert.equal(route.stack.length, 2);
    assert.equal(route.stack[0].handle, authenticate);
});

test("GET /api/user returns the public user projection and omits secrets", async () => {
    const route = getRoute();
    const fullUser = {
        id: "reader-1",
        email: "reader@example.com",
        name: "Reader One",
        image: null,
        username: "reader_one",
        googleId: "google-123",
        passwordHash: "scrypt$v1$secret",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    const result = await invoke(route.stack[1].handle, { user: fullUser });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, authResponse(fullUser));
    assert.deepEqual(result.body, {
        user: {
            id: "reader-1",
            email: "reader@example.com",
            name: "Reader One",
            image: null,
            username: "reader_one",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
    });
    assert.equal("passwordHash" in (result.body as any).user, false);
    assert.equal("googleId" in (result.body as any).user, false);
    assert.equal("token" in (result.body as any), false);
});

test("GET /api/user authenticate rejects missing sessions", async () => {
    const result = await invoke(authenticate, {
        headers: {},
        get() {
            return undefined;
        },
    } as Partial<Request>);

    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.body, { message: "No session provided" });
});
