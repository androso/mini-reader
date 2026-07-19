import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("authenticated progress routes resolve the route value as Books.id", () => {
    const routePath = existsSync("src/routes/Tracker.routes.ts")
        ? "src/routes/Tracker.routes.ts"
        : "apps/api/src/routes/Tracker.routes.ts";
    const source = readFileSync(routePath, "utf8");
    const authenticatedRoutes = source.slice(source.indexOf('router.get(\n    "/:rid/progress"'));

    assert.match(authenticatedRoutes, /eq\(Books\.id, bookId\)/);
    assert.doesNotMatch(authenticatedRoutes, /Books\.fileKey/);
    assert.match(source, /router\.get\(\n    "\/progress"/);
});
