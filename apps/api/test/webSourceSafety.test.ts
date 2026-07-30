import assert from "node:assert/strict";
import test from "node:test";
import {
    formatCitedWebAnswer,
    normalizePublicWebUrl,
    normalizeWebSourceTitle,
} from "../src/services/WebSourceSafety";

test("normalizePublicWebUrl rejects invalid schemes, credentials, control characters, and private hosts", () => {
    assert.equal(normalizePublicWebUrl(null), null);
    assert.equal(normalizePublicWebUrl("ftp://example.com"), null);
    assert.equal(normalizePublicWebUrl("https://user:pass@example.com"), null);
    assert.equal(normalizePublicWebUrl("https://example.com/\u0001"), null);
    assert.equal(normalizePublicWebUrl("https://localhost/x"), null);
    assert.equal(normalizePublicWebUrl("https://app.localhost/x"), null);
    assert.equal(normalizePublicWebUrl("https://printer.local/x"), null);
    assert.equal(normalizePublicWebUrl("http://127.0.0.1/x"), null);
    assert.equal(normalizePublicWebUrl("http://10.1.2.3/x"), null);
    assert.equal(normalizePublicWebUrl("http://192.168.1.1/x"), null);
    assert.equal(normalizePublicWebUrl("http://172.16.0.1/x"), null);
    assert.equal(normalizePublicWebUrl("http://169.254.1.1/x"), null);
    assert.equal(normalizePublicWebUrl("http://[::1]/"), null);
    assert.equal(normalizePublicWebUrl("http://[fc00::1]/"), null);
    assert.equal(normalizePublicWebUrl("http://[fe80::1]/"), null);
    assert.equal(
        normalizePublicWebUrl("https://example.com/path"),
        "https://example.com/path"
    );
});

test("normalizeWebSourceTitle falls back to hostname and truncates", () => {
    assert.equal(
        normalizeWebSourceTitle(
            "  Title\u0007Here  ",
            "https://docs.example.com/a"
        ),
        "Title Here"
    );
    assert.equal(
        normalizeWebSourceTitle(123, "https://docs.example.com/a"),
        "docs.example.com"
    );
    assert.equal(
        normalizeWebSourceTitle("x".repeat(250), "https://docs.example.com/a")
            .length,
        200
    );
});

test("formatCitedWebAnswer dedupes citations, skips invalid offsets, and inserts in reverse order", () => {
    const content = "Alpha Bravo Charlie";
    const result = formatCitedWebAnswer(content, [
        {
            type: "url_citation",
            url: "https://example.com/a",
            title: "A",
            end_index: 5,
        },
        {
            type: "url_citation",
            url: "https://example.com/a",
            title: "A again",
            end_index: 11,
        },
        {
            type: "url_citation",
            url: "https://127.0.0.1/private",
            title: "private",
            end_index: 11,
        },
        {
            type: "url_citation",
            url: "https://example.com/a",
            title: "bad negative",
            end_index: -1,
        },
        {
            type: "url_citation",
            url: "https://example.com/a",
            title: "bad overflow",
            end_index: 999,
        },
        { type: "other" },
        null,
    ]);

    assert.ok(result);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0]?.url, "https://example.com/a");
    assert.equal(
        result.content,
        "Alpha [1](<https://example.com/a>) Bravo [1](<https://example.com/a>) Charlie"
    );
    assert.equal(formatCitedWebAnswer("   ", []), null);
    assert.equal(formatCitedWebAnswer(content, "not-array"), null);
    assert.equal(
        formatCitedWebAnswer(content, [
            {
                type: "url_citation",
                url: "https://example.com/only-source",
                title: "No offset",
            },
        ]),
        null
    );
});
