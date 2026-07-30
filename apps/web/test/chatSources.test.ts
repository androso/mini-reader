import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAllowedWebUrl } from "../src/lib/chatSources";

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
        "ftp://example.com/file",
        "https://user:pass@example.com/",
        "http://localhost/private",
        "http://app.localhost/private",
        "http://printer.local/private",
        "http://127.0.0.1/private",
        "http://10.0.0.8/private",
        "http://0.0.0.0/private",
        "http://169.254.1.1/private",
        "http://192.168.1.1/private",
        "http://172.16.0.1/private",
        "http://172.31.255.255/private",
        "http://[::1]/private",
        "http://[::]/private",
        "http://[fc00::1]/private",
        "http://[fd12:3456:789a::1]/private",
        "http://[fe80::1]/private",
    ]) {
        assert.equal(normalizeAllowedWebUrl(url, new Set([url])), null, url);
    }
});

test("rejects non-strings, control characters, overlong, and invalid URLs", () => {
    const allowed = new Set(["https://example.com/ok"]);

    for (const candidate of [
        null,
        undefined,
        42,
        {},
        "https://example.com/\u0000ok",
        `https://example.com/${"a".repeat(2048)}`,
        "not a url",
        "https://",
    ] as const) {
        assert.equal(
            normalizeAllowedWebUrl(candidate, allowed),
            null,
            String(candidate)
        );
    }
});

test("allows http when the canonical URL is in the source list", () => {
    const allowed = new Set(["http://example.com/source"]);
    assert.equal(
        normalizeAllowedWebUrl("http://example.com/source", allowed),
        "http://example.com/source"
    );
    assert.equal(
        normalizeAllowedWebUrl("http://example.com/source?q=1", allowed),
        null
    );
});
