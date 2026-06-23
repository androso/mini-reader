import assert from "node:assert/strict";
import test from "node:test";
import healthRoutes from "../src/routes/Health.routes";

test("health route reports ok", async () => {
    const stack = (
        healthRoutes as unknown as {
            stack: Array<{
                route?: {
                    path: string;
                    methods: Record<string, boolean>;
                    stack: Array<{
                        handle: (req: never, res: never, next: never) => void;
                    }>;
                };
            }>;
        }
    ).stack;
    const layer = stack.find(
        (item) => item.route?.path === "/" && item.route?.methods.get
    );
    assert.ok(layer);

    const handler = layer.route!.stack[0].handle;
    let statusCode = 200;
    let body: unknown;

    const res = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        json(payload: unknown) {
            body = payload;
            return this;
        },
    };

    handler({} as never, res as never, (() => undefined) as never);

    assert.equal(statusCode, 200);
    assert.deepEqual(body, { status: "ok" });
});
