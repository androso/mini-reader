import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import {
    decryptCredentialSecret,
    encryptCredentialSecret,
    validateCodexEnvironment,
} from "../src/services/CodexCredentialService";
import {
    CODEX_AUTHORIZATION_URL,
    CODEX_CLIENT_ID,
    CODEX_REDIRECT_URI,
    CODEX_SCOPE,
    buildCodexAuthorizationUrl,
    decodeCodexAccountMetadata,
} from "../src/services/CodexOAuthService";

const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
};

const unsignedJwt = (payload: Record<string, unknown>) =>
    [
        Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
        Buffer.from(JSON.stringify(payload)).toString("base64url"),
        "signature",
    ].join(".");

test("Codex credential encryption binds ciphertext to user and field", () => {
    const previousEnabled = process.env.CODEX_OAUTH_ENABLED;
    const previousKey = process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY;
    process.env.CODEX_OAUTH_ENABLED = "true";
    process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY =
        randomBytes(32).toString("base64");
    try {
        const encrypted = encryptCredentialSecret(
            "secret-token",
            "user-1",
            "access"
        );
        assert.match(
            encrypted,
            /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
        );
        assert.equal(
            decryptCredentialSecret(encrypted, "user-1", "access"),
            "secret-token"
        );
        assert.throws(() =>
            decryptCredentialSecret(encrypted, "user-2", "access")
        );
        assert.throws(() =>
            decryptCredentialSecret(encrypted, "user-1", "refresh")
        );

        const parts = encrypted.split(".");
        parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith("A") ? "B" : "A"}`;
        assert.throws(() =>
            decryptCredentialSecret(parts.join("."), "user-1", "access")
        );

        process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY =
            randomBytes(32).toString("base64");
        assert.throws(() =>
            decryptCredentialSecret(encrypted, "user-1", "access")
        );
    } finally {
        restore("CODEX_OAUTH_ENABLED", previousEnabled);
        restore("CODEX_CREDENTIAL_ENCRYPTION_KEY", previousKey);
    }
});

test("Codex environment validation is gated and requires HTTPS in production", () => {
    const previous = {
        enabled: process.env.CODEX_OAUTH_ENABLED,
        key: process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY,
        nodeEnv: process.env.NODE_ENV,
        frontend: process.env.FRONTEND_URL,
    };
    try {
        process.env.CODEX_OAUTH_ENABLED = "false";
        delete process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY;
        assert.doesNotThrow(validateCodexEnvironment);

        process.env.CODEX_OAUTH_ENABLED = "true";
        assert.throws(validateCodexEnvironment, /is required/);
        process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY =
            randomBytes(32).toString("base64");
        Object.assign(process.env, { NODE_ENV: "production" });
        process.env.FRONTEND_URL = "http://reader.example.com";
        assert.throws(validateCodexEnvironment, /HTTPS/);
        process.env.FRONTEND_URL = "https://reader.example.com";
        assert.doesNotThrow(validateCodexEnvironment);
    } finally {
        restore("CODEX_OAUTH_ENABLED", previous.enabled);
        restore("CODEX_CREDENTIAL_ENCRYPTION_KEY", previous.key);
        restore("NODE_ENV", previous.nodeEnv);
        restore("FRONTEND_URL", previous.frontend);
    }
});

test("Codex authorization URL fixes the OpenAI endpoint and PKCE parameters", () => {
    const verifier = "reader-test-verifier";
    const state = "reader-test-state";
    const authorizationUrl = new URL(
        buildCodexAuthorizationUrl(verifier, state)
    );
    assert.equal(
        authorizationUrl.origin + authorizationUrl.pathname,
        CODEX_AUTHORIZATION_URL
    );
    assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
    assert.equal(
        authorizationUrl.searchParams.get("client_id"),
        CODEX_CLIENT_ID
    );
    assert.equal(
        authorizationUrl.searchParams.get("redirect_uri"),
        CODEX_REDIRECT_URI
    );
    assert.equal(authorizationUrl.searchParams.get("scope"), CODEX_SCOPE);
    assert.equal(authorizationUrl.searchParams.get("state"), state);
    assert.equal(
        authorizationUrl.searchParams.get("code_challenge_method"),
        "S256"
    );
    assert.equal(
        authorizationUrl.searchParams.get("code_challenge"),
        createHash("sha256").update(verifier).digest("base64url")
    );
    assert.equal(
        authorizationUrl.searchParams.get("id_token_add_organizations"),
        "true"
    );
    assert.equal(
        authorizationUrl.searchParams.get("codex_cli_simplified_flow"),
        "true"
    );
    assert.equal(
        authorizationUrl.searchParams.get("originator"),
        "reader-monorepo"
    );
});

test("Codex account metadata comes from nested ID token claims", () => {
    const idToken = unsignedJwt({
        email: "reader@example.com",
        "https://api.openai.com/auth": {
            chatgpt_account_id: "account-123",
            chatgpt_plan_type: "plus",
        },
    });

    assert.deepEqual(decodeCodexAccountMetadata(idToken), {
        accountId: "account-123",
        email: "reader@example.com",
        planType: "plus",
    });
    assert.throws(
        () =>
            decodeCodexAccountMetadata(
                unsignedJwt({
                    "https://api.openai.com/auth": {
                        chatgpt_plan_type: "plus",
                    },
                })
            ),
        /did not identify an account/
    );
});
