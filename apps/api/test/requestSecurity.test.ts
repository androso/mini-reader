import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import cors from "cors";
import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { asyncHandler } from "../src/middleware/asyncHandler";
import {
    enforceTrustedOrigin,
    frontendCorsOptions,
} from "../src/middleware/csrf";
import { terminalErrorHandler } from "../src/middleware/errorHandler";

const trustedOrigin = "http://localhost:3000";

const withServer = async (
    configure: (app: express.Express) => void,
    run: (baseUrl: string) => Promise<void>
) => {
    const app = express();
    configure(app);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    try {
        await run(`http://127.0.0.1:${port}`);
    } finally {
        server.close();
        await once(server, "close");
    }
};

test("trusted mutation origins are accepted", async () => {
    process.env.FRONTEND_URL = `${trustedOrigin}/app`;
    await withServer(
        (app) => {
            app.use(cors(frontendCorsOptions()));
            app.use(express.json());
            app.use(enforceTrustedOrigin);
            app.all("/mutation", (_req, res) => res.status(204).end());
        },
        async (baseUrl) => {
            for (const method of ["POST", "PATCH", "DELETE"]) {
                const response = await fetch(`${baseUrl}/mutation`, {
                    method,
                    headers: { Origin: trustedOrigin },
                });
                assert.equal(response.status, 204, method);
                assert.equal(
                    response.headers.get("access-control-allow-origin"),
                    trustedOrigin
                );
                assert.equal(
                    response.headers.get("access-control-allow-credentials"),
                    "true"
                );
            }
        }
    );
});

test("untrusted, missing, and malformed mutation origins are rejected", async () => {
    process.env.FRONTEND_URL = trustedOrigin;
    await withServer(
        (app) => {
            app.use(cors(frontendCorsOptions()));
            app.use(express.json());
            app.use(enforceTrustedOrigin);
            app.all("/mutation", (_req, res) => res.status(204).end());
        },
        async (baseUrl) => {
            for (const method of ["POST", "PATCH", "DELETE"]) {
                const response = await fetch(`${baseUrl}/mutation`, {
                    method,
                    headers: { Origin: "https://attacker.example" },
                });
                assert.equal(response.status, 403, method);
                assert.deepEqual(await response.json(), {
                    message: "Untrusted request origin",
                });
            }

            for (const origin of [
                undefined,
                "not a url",
                `${trustedOrigin}/path`,
            ]) {
                const headers = origin ? { Origin: origin } : undefined;
                const response = await fetch(`${baseUrl}/mutation`, {
                    method: "POST",
                    headers,
                });
                assert.equal(response.status, 403, String(origin));
            }
        }
    );
});

test("CSRF rejection runs before malformed mutation body parsing", async () => {
    process.env.FRONTEND_URL = trustedOrigin;
    await withServer(
        (app) => {
            app.use(cors(frontendCorsOptions()));
            app.use(enforceTrustedOrigin);
            app.use(express.json());
            app.post("/mutation", (_req, res) => res.status(204).end());
            app.use(terminalErrorHandler);
        },
        async (baseUrl) => {
            for (const origin of [undefined, "https://attacker.example"]) {
                const headers: Record<string, string> = {
                    "Content-Type": "application/json",
                };
                if (origin) headers.Origin = origin;

                const response = await fetch(`${baseUrl}/mutation`, {
                    method: "POST",
                    headers,
                    body: "{",
                });
                assert.equal(response.status, 403, String(origin));
                assert.deepEqual(await response.json(), {
                    message: "Untrusted request origin",
                });
            }
        }
    );
});

test("safe methods bypass CSRF and trusted preflight supports credentials", async () => {
    process.env.FRONTEND_URL = trustedOrigin;
    await withServer(
        (app) => {
            app.use(cors(frontendCorsOptions()));
            app.use(enforceTrustedOrigin);
            app.all("/resource", (_req, res) => res.status(200).send("ok"));
        },
        async (baseUrl) => {
            for (const method of ["GET", "HEAD"]) {
                const response = await fetch(`${baseUrl}/resource`, { method });
                assert.equal(response.status, 200, method);
            }

            const response = await fetch(`${baseUrl}/resource`, {
                method: "OPTIONS",
                headers: {
                    Origin: trustedOrigin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "Content-Type",
                },
            });
            assert.equal(response.status, 204);
            assert.equal(
                response.headers.get("access-control-allow-origin"),
                trustedOrigin
            );
            assert.equal(
                response.headers.get("access-control-allow-credentials"),
                "true"
            );
            assert.match(
                response.headers.get("access-control-allow-methods") ?? "",
                /POST/
            );
        }
    );
});

test("mobile token endpoints do not require a browser Origin", async () => {
    process.env.FRONTEND_URL = trustedOrigin;
    await withServer(
        (app) => {
            app.use(enforceTrustedOrigin);
            app.post("/api/auth/mobile/login", (_req, res) =>
                res.status(204).end()
            );
            app.post("/api/books", (_req, res) => res.status(204).end());
        },
        async (baseUrl) => {
            const mobile = await fetch(`${baseUrl}/api/auth/mobile/login`, {
                method: "POST",
            });
            assert.equal(mobile.status, 204);

            const ownedMutation = await fetch(`${baseUrl}/api/books`, {
                method: "POST",
            });
            assert.equal(ownedMutation.status, 403);
        }
    );
});

test("ordinary async rejections reach the generic terminal 500", async () => {
    await withServer(
        (app) => {
            app.get(
                "/failure",
                asyncHandler(async () => {
                    throw new Error("sensitive database detail");
                })
            );
            app.use(terminalErrorHandler);
        },
        async (baseUrl) => {
            const originalError = console.error;
            console.error = () => undefined;
            try {
                const response = await fetch(`${baseUrl}/failure`);
                assert.equal(response.status, 500);
                assert.deepEqual(await response.json(), {
                    error: "Internal server error",
                });
            } finally {
                console.error = originalError;
            }
        }
    );
});

test("trusted malformed JSON preserves parser 400 with a generic body", async () => {
    process.env.FRONTEND_URL = trustedOrigin;
    await withServer(
        (app) => {
            app.use(enforceTrustedOrigin);
            app.use(express.json());
            app.post("/mutation", (_req, res) => res.status(204).end());
            app.use(terminalErrorHandler);
        },
        async (baseUrl) => {
            const response = await fetch(`${baseUrl}/mutation`, {
                method: "POST",
                headers: {
                    Origin: trustedOrigin,
                    "Content-Type": "application/json",
                },
                body: "{",
            });
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), {
                error: "Invalid request",
            });
        }
    );
});

test("trusted oversized JSON preserves parser 413 with a generic body", async () => {
    process.env.FRONTEND_URL = trustedOrigin;
    await withServer(
        (app) => {
            app.use(enforceTrustedOrigin);
            app.use(express.json({ limit: "4b" }));
            app.post("/mutation", (_req, res) => res.status(204).end());
            app.use(terminalErrorHandler);
        },
        async (baseUrl) => {
            const response = await fetch(`${baseUrl}/mutation`, {
                method: "POST",
                headers: {
                    Origin: trustedOrigin,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ value: "too large" }),
            });
            assert.equal(response.status, 413);
            assert.deepEqual(await response.json(), {
                error: "Invalid request",
            });
        }
    );
});

test("terminal errors delegate after streaming headers were sent", () => {
    const error = new Error("stream failed");
    let delegated: unknown;
    const response = { headersSent: true } as Response;
    terminalErrorHandler(error, {} as Request, response, ((
        received: unknown
    ) => {
        delegated = received;
    }) as NextFunction);
    assert.equal(delegated, error);
});
