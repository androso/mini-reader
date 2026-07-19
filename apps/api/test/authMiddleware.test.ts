import assert from "node:assert/strict";
import test from "node:test";

process.env.JWT_SECRET ??= "test-jwt-secret";
process.env.GOOGLE_CLIENT_ID ??= "reader-web.apps.googleusercontent.com";

test("auth middleware token lookup follows the active environment", async () => {
    const { readSessionToken } = await import("../src/middleware/auth");
    const previous = process.env.NODE_ENV;
    try {
        process.env.NODE_ENV = "production";
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

        process.env.NODE_ENV = "test";
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
        process.env.NODE_ENV = previous;
    }
});
