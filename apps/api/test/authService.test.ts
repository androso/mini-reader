import assert from "node:assert/strict";
import test from "node:test";
import type { LoginTicket, VerifyIdTokenOptions } from "google-auth-library";

process.env.JWT_SECRET ??= "test-jwt-secret";
process.env.GOOGLE_CLIENT_ID = "reader-web.apps.googleusercontent.com";

test("verifyGoogleToken returns identity from a verified ID token payload", async () => {
    const { verifyGoogleToken } = await import("../src/services/AuthService");
    const verifier = {
        async verifyIdToken(options: VerifyIdTokenOptions) {
            assert.deepEqual(options, {
                idToken: "valid-id-token",
                audience: "reader-web.apps.googleusercontent.com",
            });
            return {
                getPayload: () => ({
                    sub: "google-user-123",
                    email: "reader@example.com",
                    name: "Reader User",
                    picture: "https://example.com/avatar.png",
                }),
            } as LoginTicket;
        },
    };

    const identity = await verifyGoogleToken("valid-id-token", verifier);

    assert.deepEqual(identity, {
        sub: "google-user-123",
        email: "reader@example.com",
        name: "Reader User",
        picture: "https://example.com/avatar.png",
    });
});

test("verifyGoogleToken rejects a token for a mismatched audience", async () => {
    const { verifyGoogleToken } = await import("../src/services/AuthService");
    const verifier = {
        async verifyIdToken() {
            throw new Error("Wrong recipient, payload audience != requiredAudience");
        },
    };

    await assert.rejects(
        verifyGoogleToken("wrong-audience-id-token", verifier),
        /Failed to verify token/
    );
});
