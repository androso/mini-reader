import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
    FixedWindowRateLimiter,
    authRateLimit,
    chatRateLimit,
    createRateLimit,
    uploadRateLimit,
} from "../src/middleware/rateLimit";

const invokeMiddleware = (
    middleware: RequestHandler,
    request: Partial<Request>
) => {
    const headers = new Map<string, string>();
    let body: unknown;
    let nextCalls = 0;
    let statusCode = 200;
    const response = {
        setHeader(name: string, value: string) {
            headers.set(name.toLowerCase(), value);
            return response;
        },
        status(code: number) {
            statusCode = code;
            return response;
        },
        json(value: unknown) {
            body = value;
            return response;
        },
    } as unknown as Response;
    const next: NextFunction = () => {
        nextCalls++;
    };

    middleware(request as Request, response, next);
    return { body, headers, nextCalls, statusCode };
};

test("fixed windows enforce the exact limit and reset at expiry", () => {
    let now = 10_250;
    const limiter = new FixedWindowRateLimiter({
        limit: 2,
        windowMs: 5_000,
        now: () => now,
    });

    assert.equal(limiter.consume("reader").allowed, true);
    assert.equal(limiter.consume("reader").allowed, true);
    assert.deepEqual(limiter.consume("reader"), {
        allowed: false,
        retryAfterSeconds: 5,
    });

    now = 15_249;
    assert.deepEqual(limiter.consume("reader"), {
        allowed: false,
        retryAfterSeconds: 1,
    });

    now = 15_250;
    assert.deepEqual(limiter.consume("reader"), {
        allowed: true,
        retryAfterSeconds: 5,
    });
});

test("expiry removes stale buckets using the injected clock", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({
        limit: 1,
        windowMs: 1_000,
        now: () => now,
    });

    limiter.consume("");
    now = 500;
    limiter.consume("second");
    assert.equal(limiter.size, 2);

    now = 1_000;
    limiter.consume("third");
    assert.equal(limiter.size, 2);
    assert.equal(limiter.consume("").allowed, true);
});

test("a full store evicts the bucket with the earliest expiry", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({
        limit: 1,
        windowMs: 1_000,
        maxEntries: 2,
        now: () => now,
    });

    limiter.consume("");
    now = 100;
    limiter.consume("second");
    now = 200;
    limiter.consume("third");

    assert.equal(limiter.size, 2);
    now = 201;
    assert.equal(
        limiter.consume("").allowed,
        true,
        "the earliest bucket should have been evicted"
    );
    assert.equal(limiter.size, 2);
});

test("namespaces and identities have independent counters", () => {
    const options = {
        limit: 1,
        windowMs: 10_000,
        now: () => 0,
        identity: (req: Request) => req.ip || "unknown-client",
    };
    const auth = createRateLimit({ namespace: "auth-test", ...options });
    const upload = createRateLimit({ namespace: "upload-test", ...options });

    assert.equal(invokeMiddleware(auth, { ip: "client-a" }).nextCalls, 1);
    assert.equal(invokeMiddleware(auth, { ip: "client-b" }).nextCalls, 1);
    assert.equal(invokeMiddleware(upload, { ip: "client-a" }).nextCalls, 1);

    const blocked = invokeMiddleware(auth, { ip: "client-a" });
    assert.equal(blocked.nextCalls, 0);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.headers.get("retry-after"), "10");
    assert.deepEqual(blocked.body, { error: "Too many requests" });
});

test("invalid limiter configuration and clocks fail closed", () => {
    for (const options of [
        { limit: 0, windowMs: 1 },
        { limit: 1, windowMs: 0 },
        { limit: 1, windowMs: 1, maxEntries: 0 },
    ]) {
        assert.throws(
            () => new FixedWindowRateLimiter(options),
            /positive integer/
        );
    }

    const invalidClock = new FixedWindowRateLimiter({
        limit: 1,
        windowMs: 1,
        now: () => Number.NaN,
    });
    assert.throws(() => invalidClock.consume("reader"), /finite number/);
});

type RouteLayer = {
    route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
    };
};

test("the app trusts only loopback proxies and limits auth before its router", async () => {
    process.env.JWT_SECRET ??= "rate-limit-test-secret";
    process.env.GOOGLE_CLIENT_ID ??= "reader-web.apps.googleusercontent.com";
    process.env.OPENAI_API_KEY ??= "rate-limit-test-key";
    process.env.FRONTEND_URL ??= "http://localhost:3001";
    const [{ default: app }, { default: authRouter }] = await Promise.all([
        import("../src/app"),
        import("../src/routes/Auth.routes"),
    ]);
    const trustProxy = app.get("trust proxy fn") as (
        address: string,
        index: number
    ) => boolean;

    assert.equal(trustProxy("127.0.0.1", 0), true);
    assert.equal(trustProxy("::1", 0), true);
    assert.equal(trustProxy("10.0.0.4", 0), false);
    assert.equal(trustProxy("203.0.113.4", 0), false);

    const stack = (
        app as unknown as {
            _router: { stack: Array<{ handle: RequestHandler }> };
        }
    )._router.stack;
    const limiterIndex = stack.findIndex(
        (layer) => layer.handle === authRateLimit
    );
    const routerIndex = stack.findIndex((layer) => layer.handle === authRouter);
    assert.ok(limiterIndex >= 0);
    assert.ok(routerIndex > limiterIndex);

    let authSideEffects = 0;
    for (let request = 0; request < 21; request++) {
        authSideEffects += invokeMiddleware(authRateLimit, {
            ip: "198.51.100.25",
        }).nextCalls;
    }
    assert.equal(authSideEffects, 20);
    assert.equal(
        invokeMiddleware(authRateLimit, { ip: "198.51.100.26" }).nextCalls,
        1,
        "client IPs must have independent auth limits"
    );
});

test("upload and chat limits run after auth and before every side effect", async () => {
    process.env.JWT_SECRET ??= "rate-limit-test-secret";
    process.env.OPENAI_API_KEY ??= "rate-limit-test-key";
    const [{ default: bookRouter }, { default: chatRouter }, { authenticate }] =
        await Promise.all([
            import("../src/routes/Book.routes"),
            import("../src/routes/Chat.routes"),
            import("../src/middleware/auth"),
        ]);

    const bookRoute = (
        bookRouter as unknown as { stack: RouteLayer[] }
    ).stack.find(
        (layer) => layer.route?.path === "/" && layer.route.methods.post
    )?.route;
    assert.ok(bookRoute);
    assert.equal(bookRoute.stack[0].handle, authenticate);
    assert.equal(bookRoute.stack[1].handle, uploadRateLimit);
    assert.equal(bookRoute.stack.length, 4);

    const chatRoutes = (
        chatRouter as unknown as { stack: RouteLayer[] }
    ).stack.filter(
        (layer) =>
            layer.route?.methods.post &&
            [
                "/:resourceType/:id/conversations",
                "/:resourceType/:rid/conversations/:cid/messages",
            ].includes(layer.route.path)
    );
    assert.equal(chatRoutes.length, 2);
    for (const layer of chatRoutes) {
        assert.equal(layer.route?.stack.length, 3);
        assert.equal(layer.route?.stack[0].handle, authenticate);
        assert.equal(layer.route?.stack[1].handle, chatRateLimit);
    }

    const user = {
        id: "rate-limit-route-user",
    } as Request["user"];
    let uploadSideEffects = 0;
    for (let request = 0; request < 11; request++) {
        uploadSideEffects += invokeMiddleware(uploadRateLimit, {
            user,
        }).nextCalls;
    }
    assert.equal(uploadSideEffects, 10);

    let chatSideEffects = 0;
    for (let request = 0; request < 31; request++) {
        chatSideEffects += invokeMiddleware(chatRateLimit, { user }).nextCalls;
    }
    assert.equal(chatSideEffects, 30);
});
