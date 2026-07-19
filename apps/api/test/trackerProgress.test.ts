import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { Books, Progress } from "../src/db/schema";
import type { TrackerDatabase } from "../src/routes/Tracker.routes";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "tracker-test-secret";
const { createTrackerRouter } =
    require("../src/routes/Tracker.routes") as typeof import("../src/routes/Tracker.routes");

type RouteLayer = {
    route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{
            handle: (req: Request, res: Response, next: NextFunction) => void;
        }>;
    };
};

const createResponse = () => {
    let statusCode = 200;
    let body: unknown;
    const response = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        json(payload: unknown) {
            body = payload;
            return this;
        },
    } as Response;

    return {
        response,
        get statusCode() {
            return statusCode;
        },
        get body() {
            return body;
        },
    };
};

const createDatabase = ({
    bookRows = [],
    progressRows = [],
}: {
    bookRows?: unknown[];
    progressRows?: unknown[];
}) => {
    const calls: string[] = [];
    let conflictTarget: unknown;
    let insertedValues: Record<string, unknown> | undefined;
    let conflictSet: Record<string, unknown> | undefined;

    const database = {
        select: () => ({
            from: (table: unknown) => {
                calls.push(
                    table === Books ? "select:books" : "select:progress"
                );
                return {
                    where: async () =>
                        table === Books ? bookRows : progressRows,
                };
            },
        }),
        insert: (table: unknown) => {
            assert.equal(table, Progress);
            calls.push("insert:progress");
            return {
                values: (values: Record<string, unknown>) => {
                    insertedValues = values;
                    calls.push("values:progress");
                    return {
                        onConflictDoUpdate: (config: {
                            target: unknown;
                            set: Record<string, unknown>;
                        }) => {
                            conflictTarget = config.target;
                            conflictSet = config.set;
                            calls.push("conflict-update:progress");
                            return {
                                returning: async () => [
                                    { ...values, ...config.set },
                                ],
                            };
                        },
                    };
                },
            };
        },
    } as unknown as TrackerDatabase;

    return {
        database,
        calls,
        get conflictTarget() {
            return conflictTarget;
        },
        get conflictSet() {
            return conflictSet;
        },
        get insertedValues() {
            return insertedValues;
        },
    };
};

const routeHandler = (database: TrackerDatabase, method: "get" | "post") => {
    const router = createTrackerRouter(database) as unknown as {
        stack: RouteLayer[];
    };
    const layer = router.stack.find(
        (candidate) =>
            candidate.route?.path === "/:rid/progress" &&
            candidate.route.methods[method]
    );
    assert.ok(layer?.route);
    return layer.route.stack.at(-1)!.handle;
};

const invoke = async (
    database: TrackerDatabase,
    method: "get" | "post",
    request: unknown
) => {
    const result = createResponse();
    await routeHandler(database, method)(
        request as Request,
        result.response,
        (() => undefined) as NextFunction
    );
    return result;
};

test("does not register the unauthenticated global progress route", () => {
    const { database } = createDatabase({});
    const router = createTrackerRouter(database) as unknown as {
        stack: RouteLayer[];
    };
    assert.equal(
        router.stack.some((layer) => layer.route?.path === "/progress"),
        false
    );
});

test("returns owner progress only after resolving the owned book", async () => {
    const mock = createDatabase({
        bookRows: [{ id: "20000000-0000-4000-8000-000000000001" }],
        progressRows: [
            {
                progressPosition: "c01-block-2",
                progressChapter: "c01",
            },
        ],
    });
    const result = await invoke(mock.database, "get", {
        user: { id: "10000000-0000-4000-8000-000000000001" },
        params: { rid: "20000000-0000-4000-8000-000000000001" },
    });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
        progressPosition: "c01-block-2",
        progressChapter: "c01",
    });
    assert.deepEqual(mock.calls, ["select:books", "select:progress"]);
});

test("returns the initial null state for an owned book without progress", async () => {
    const mock = createDatabase({
        bookRows: [{ id: "20000000-0000-4000-8000-000000000001" }],
    });
    const result = await invoke(mock.database, "get", {
        user: { id: "10000000-0000-4000-8000-000000000001" },
        params: { rid: "20000000-0000-4000-8000-000000000001" },
    });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, { progressPosition: null });
    assert.deepEqual(mock.calls, ["select:books", "select:progress"]);
});

for (const scenario of ["missing", "non-owned"] as const) {
    test(`returns 404 for a ${scenario} book before reading progress`, async () => {
        const mock = createDatabase({ bookRows: [] });
        const result = await invoke(mock.database, "get", {
            user: { id: "10000000-0000-4000-8000-000000000001" },
            params: { rid: "20000000-0000-4000-8000-000000000099" },
        });

        assert.equal(result.statusCode, 404);
        assert.deepEqual(result.body, { message: "Book not found" });
        assert.deepEqual(mock.calls, ["select:books"]);
    });
}

test("upserts owner progress after ownership resolution using the composite key", async () => {
    const bookId = "20000000-0000-4000-8000-000000000001";
    const userId = "10000000-0000-4000-8000-000000000001";
    const mock = createDatabase({ bookRows: [{ id: bookId }] });
    const result = await invoke(mock.database, "post", {
        user: { id: userId },
        params: { rid: bookId },
        body: {
            progress_block: "c02-block-4",
            progress_chapter: "c02",
        },
    });

    assert.equal(result.statusCode, 201);
    assert.deepEqual(mock.calls, [
        "select:books",
        "insert:progress",
        "values:progress",
        "conflict-update:progress",
    ]);
    assert.deepEqual(mock.conflictTarget, [Progress.userId, Progress.bookId]);
    assert.equal(mock.insertedValues?.userId, userId);
    assert.equal(mock.insertedValues?.bookId, bookId);
    assert.equal(mock.conflictSet?.progressPosition, "c02-block-4");
    assert.equal(mock.conflictSet?.progressChapter, "c02");
});

test("does not write progress when the book is missing or non-owned", async () => {
    const mock = createDatabase({ bookRows: [] });
    const result = await invoke(mock.database, "post", {
        user: { id: "10000000-0000-4000-8000-000000000001" },
        params: { rid: "20000000-0000-4000-8000-000000000099" },
        body: { progress_block: "c01-block-1", progress_chapter: "c01" },
    });

    assert.equal(result.statusCode, 404);
    assert.deepEqual(mock.calls, ["select:books"]);
});
