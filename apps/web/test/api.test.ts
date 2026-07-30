import assert from "node:assert/strict";
import test from "node:test";
import { apiUrl } from "../src/lib/api";

test("apiUrl joins the configured base with the request path", () => {
    const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

    for (const [path, expected] of [
        ["/api/books", `${base}/api/books`],
        ["/api/user", `${base}/api/user`],
        ["", base],
        [
            "/api/books/11111111-1111-4111-8111-111111111111",
            `${base}/api/books/11111111-1111-4111-8111-111111111111`,
        ],
    ] as const) {
        assert.equal(apiUrl(path), expected, path || "(empty path)");
    }
});
