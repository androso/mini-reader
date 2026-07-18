import assert from "node:assert/strict";
import test from "node:test";

process.env.JWT_SECRET ??= "test-jwt-secret";
process.env.GOOGLE_CLIENT_ID ??= "reader-web.apps.googleusercontent.com";

test("auth middleware token lookup uses the Reader session cookie", async () => {
    const { readSessionToken } = await import("../src/middleware/auth");
    assert.equal(
        readSessionToken({
            headers: { cookie: "unrelated=1; reader_session=cookie-jwt" },
        }),
        "cookie-jwt"
    );
    assert.equal(
        readSessionToken({
            headers: { authorization: "Bearer legacy-jwt" },
        }),
        undefined
    );
});
