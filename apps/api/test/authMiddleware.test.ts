import assert from "node:assert/strict";
import test from "node:test";

process.env.JWT_SECRET ??= "test-jwt-secret";
process.env.GOOGLE_CLIENT_ID ??= "reader-web.apps.googleusercontent.com";

const setNodeEnv = (value?: string) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
};

test("auth middleware token lookup follows the active environment", async () => {
    const { readSessionToken } = await import("../src/middleware/auth");
    const previous = process.env.NODE_ENV;
    try {
        setNodeEnv("production");
        assert.equal(
            readSessionToken({
                headers: {
                    cookie: "reader_session=weaker-jwt; __Host-reader_session=production-jwt",
                },
            }),
            "production-jwt"
        );
        assert.equal(
            readSessionToken({
                headers: { cookie: "reader_session=weaker-jwt" },
            }),
            undefined
        );

        setNodeEnv("test");
        assert.equal(
            readSessionToken({
                headers: {
                    cookie: "__Host-reader_session=production-jwt; reader_session=test-jwt",
                },
            }),
            "test-jwt"
        );
        assert.equal(
            readSessionToken({
                headers: { cookie: "__Host-reader_session=production-jwt" },
            }),
            undefined
        );
        assert.equal(
            readSessionToken({
                headers: { authorization: "Bearer legacy-jwt" },
            }),
            undefined
        );
    } finally {
        setNodeEnv(previous);
    }
});

const invokeAuthenticate = async (req: {
    headers?: Record<string, string | undefined>;
    get?: (name: string) => string | undefined;
}) => {
    const { authenticate } = await import("../src/middleware/auth");
    let statusCode = 200;
    let body: unknown;
    let settled = false;
    const done = new Promise<void>((resolve) => {
        const finish = () => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };
        const response = {
            status(code: number) {
                statusCode = code;
                return this;
            },
            json(payload: unknown) {
                body = payload;
                finish();
                return this;
            },
        };
        const headers = req.headers ?? {};
        authenticate(
            {
                headers,
                get(name: string) {
                    if (req.get) return req.get(name);
                    const key = name.toLowerCase();
                    return headers[key] ?? headers[name];
                },
            } as any,
            response as any,
            ((error?: unknown) => {
                if (error) throw error;
                finish();
            }) as any
        );
    });
    await done;
    return { statusCode, body };
};

test("authenticate rejects malformed bearer authorization", async () => {
    const result = await invokeAuthenticate({
        headers: { authorization: "Bearer" },
        get(name) {
            return name.toLowerCase() === "authorization"
                ? "Bearer"
                : undefined;
        },
    });
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.body, { message: "Invalid bearer authorization" });
});

test("authenticate rejects invalid session cookies", async () => {
    const previous = process.env.NODE_ENV;
    try {
        (process.env as Record<string, string | undefined>).NODE_ENV = "test";
        const result = await invokeAuthenticate({
            headers: { cookie: "reader_session=not-a-valid-jwt" },
            get() {
                return undefined;
            },
        });
        assert.equal(result.statusCode, 401);
        assert.deepEqual(result.body, { message: "Invalid session" });
    } finally {
        (process.env as Record<string, string | undefined>).NODE_ENV = previous;
    }
});
