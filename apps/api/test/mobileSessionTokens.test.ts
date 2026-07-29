import assert from "node:assert/strict";
import test from "node:test";
import {
    hashRefreshSecret,
    parseRefreshToken,
    secretsMatch,
} from "../src/services/MobileSessionService";

test("mobile refresh tokens are strict and store only a one-way hash", () => {
    const sessionId = "7d08cb76-2bed-4d71-88fe-f779eb1e5985";
    const secret = "a".repeat(43);
    const hash = hashRefreshSecret(secret);

    assert.deepEqual(parseRefreshToken(`${sessionId}.${secret}`), {
        sessionId,
        secret,
    });
    assert.equal(parseRefreshToken(`${sessionId}.${secret}.extra`), null);
    assert.equal(parseRefreshToken(`${sessionId}.short`), null);
    assert.equal(hash.includes(secret), false);
    assert.equal(secretsMatch(secret, hash), true);
    assert.equal(secretsMatch("b".repeat(43), hash), false);
});
