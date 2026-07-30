import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAllowedWebUrl } from "../src/lib/chatSources.js";

test("allows only exact canonical URLs from the message source list", () => {
    const allowed = new Set(["https://example.com/source"]);
    assert.equal(
        normalizeAllowedWebUrl("https://example.com/source", allowed),
        "https://example.com/source"
    );
    assert.equal(
        normalizeAllowedWebUrl("https://example.com/other", allowed),
        null
    );
    assert.equal(
        normalizeAllowedWebUrl("https://evil.example/", allowed),
        null
    );
});

test("rejects unsafe protocols, credentials, and private hosts", () => {
    for (const url of [
        "javascript:alert(1)",
        "https://user:pass@example.com/",
        "http://localhost/private",
        "http://127.0.0.1/private",
        "http://192.168.1.1/private",
        "http://[::1]/private",
    ]) {
        assert.equal(normalizeAllowedWebUrl(url, new Set([url])), null, url);
    }
});
