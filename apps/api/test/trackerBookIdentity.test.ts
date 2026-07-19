import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("authenticated progress routes resolve the route value as Books.id", () => {
    const routePath = existsSync("src/routes/Tracker.routes.ts")
        ? "src/routes/Tracker.routes.ts"
        : "apps/api/src/routes/Tracker.routes.ts";
    const source = readFileSync(routePath, "utf8");
    const authenticatedRoutes = source.slice(
        source.indexOf('"/:rid/progress"')
    );

    assert.match(authenticatedRoutes, /eq\(Books\.id, bookId\)/);
    assert.doesNotMatch(authenticatedRoutes, /Books\.fileKey/);
    assert.doesNotMatch(source, /["']\/progress["']/);
    assert.match(authenticatedRoutes, /eq\(Books\.userId, user_id\)/);
    assert.match(source, /onConflictDoUpdate/);
});
