import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";

process.env.JWT_SECRET ??= "test-jwt-secret";
process.env.GOOGLE_CLIENT_ID ??= "reader-web.apps.googleusercontent.com";

test("authentication responses expose the user but never the Reader JWT", async () => {
    const { authResponse } = await import("../src/routes/Auth.routes");
    const user = { id: "reader-1", email: "reader@example.com" };
    assert.deepEqual(authResponse(user), { user });
    assert.equal("token" in authResponse(user), false);
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
