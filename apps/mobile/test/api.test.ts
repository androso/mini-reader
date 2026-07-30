import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

type FetchArgs = [input: string, init?: RequestInit];

const secureStore = () =>
    ((globalThis as any).__mobileTestSecureStore ??= new Map()) as Map<
        string,
        string
    >;

const setExpoFetch = (impl: (...args: FetchArgs) => Promise<Response>) => {
    (globalThis as any).__mobileTestExpoFetch = impl;
};

const session = {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessTokenExpiresIn: 900,
    refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    user: {
        id: "u1",
        email: "a@b.c",
        name: "A",
        username: "a",
        image: null as string | null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    },
};

test("apiUrl requires EXPO_PUBLIC_API_URL in a fresh process", () => {
    const apiModuleUrl = pathToFileURL(
        path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "../src/lib/api.js"
        )
    ).href;
    const result = spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `
(globalThis).__mobileTestExpoFetch = async () => new Response();
(globalThis).__mobileTestSecureStore = new Map();
process.env.EXPO_PUBLIC_API_URL = "";
const mod = await import(${JSON.stringify(apiModuleUrl)});
let ok = false;
try { mod.apiUrl("/x"); } catch (error) {
  ok = String(error?.message || error).includes("EXPO_PUBLIC_API_URL");
}
if (!ok) process.exit(1);
`,
        ],
        {
            encoding: "utf8",
            env: { ...process.env, EXPO_PUBLIC_API_URL: "" },
            cwd: path.resolve(
                path.dirname(fileURLToPath(import.meta.url)),
                ".."
            ),
        }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("hydrate, persist, clear, headers, concurrent refresh, FormData, ApiError", async () => {
    process.env.EXPO_PUBLIC_API_URL ??= "https://reader.example.test";
    secureStore().clear();
    setExpoFetch(
        async () =>
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
    );

    const api = await import("../src/lib/api.js");

    assert.equal(
        api.apiUrl("/api/user"),
        "https://reader.example.test/api/user"
    );
    assert.equal(await api.hydrateStoredSession(), null);

    await api.persistSession({ ...session });
    const hydrated = await api.hydrateStoredSession();
    assert.equal(hydrated?.accessToken, "access-1");
    assert.equal(api.currentRefreshToken(), "refresh-1");
    assert.equal(
        api.authorizedHeaders({ "X-Test": "1" }).Authorization,
        "Bearer access-1"
    );

    secureStore().set("mentarie.mobile.session", "{not-json");
    assert.equal(await api.hydrateStoredSession(), null);

    await api.persistSession({
        ...session,
        accessToken: "access-2",
        refreshToken: "refresh-2",
    });

    let invalidCalls = 0;
    api.registerInvalidSessionHandler(() => {
        invalidCalls += 1;
    });

    let refreshCalls = 0;
    setExpoFetch(async (url: string, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith("/api/auth/mobile/refresh")) {
            refreshCalls += 1;
            await new Promise((resolve) => setTimeout(resolve, 25));
            return new Response(
                JSON.stringify({
                    ...session,
                    accessToken: "access-3",
                    refreshToken: "refresh-3",
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === "Bearer access-2") {
            return new Response("nope", { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });

    const [first, second] = await Promise.all([
        api.apiFetch("/api/user"),
        api.apiFetch("/api/user"),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(refreshCalls, 1);
    assert.equal(api.currentRefreshToken(), "refresh-3");

    await api.persistSession({
        ...session,
        accessToken: "access-4",
        refreshToken: "refresh-4",
    });
    setExpoFetch(async (url: string) => {
        if (String(url).endsWith("/api/auth/mobile/refresh")) {
            return new Response("no", { status: 401 });
        }
        return new Response("no", { status: 401 });
    });
    invalidCalls = 0;
    assert.equal((await api.apiFetch("/api/user")).status, 401);
    assert.equal(invalidCalls, 1);
    assert.equal(api.currentRefreshToken(), null);

    const contentTypes: Array<string | null> = [];
    setExpoFetch(async (_url: string, init?: RequestInit) => {
        contentTypes.push(new Headers(init?.headers).get("Content-Type"));
        return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    await api.persistSession({
        ...session,
        accessToken: "access-5",
        refreshToken: "refresh-5",
    });
    await api.apiJson("/api/books", { method: "POST", body: new FormData() });
    assert.equal(contentTypes[0], null);

    const rejectWith = async (
        body: unknown,
        status: number,
        expected: string
    ) => {
        setExpoFetch(
            async () =>
                new Response(JSON.stringify(body), {
                    status,
                    headers: { "Content-Type": "application/json" },
                })
        );
        await assert.rejects(
            () => api.apiJson("/x"),
            (error: unknown) =>
                error instanceof api.ApiError && error.message === expected
        );
    };
    await rejectWith({ message: "msg", error: "err" }, 400, "msg");
    await rejectWith({ error: "err-only" }, 400, "err-only");
    await rejectWith({}, 503, "The request failed with status 503");

    await api.clearStoredSession();
    assert.equal(api.currentRefreshToken(), null);
});
