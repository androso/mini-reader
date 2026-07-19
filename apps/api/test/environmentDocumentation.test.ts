import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(__dirname, "../../..");
const read = (relativePath: string) =>
    fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

const parseEnvironment = (relativePath: string) =>
    new Map(
        read(relativePath)
            .split(/\r?\n/)
            .filter((line) => line && !line.startsWith("#"))
            .map((line) => {
                const separator = line.indexOf("=");
                return [line.slice(0, separator), line.slice(separator + 1)];
            })
    );

const assertHasKeys = (values: Map<string, string>, keys: string[]) => {
    for (const key of keys) assert.equal(values.has(key), true, key);
};

test("environment templates cover the compact local and production runtimes", () => {
    const local = parseEnvironment(".env.template");
    const production = parseEnvironment(".env.prod.example");
    const web = parseEnvironment("apps/web/.env.template");

    assertHasKeys(local, [
        "PORT",
        "FRONTEND_URL",
        "DATABASE_URL",
        "JWT_SECRET",
        "GOOGLE_CLIENT_ID",
        "OPENAI_API_KEY",
        "VECTOR_STORE_DRIVER",
        "STORAGE_DRIVER",
        "BOOK_PROCESSING_RUNNER_ENABLED",
        "BOOK_PROCESSING_MAX_ATTEMPTS",
        "BOOK_PROCESSING_POLL_INTERVAL_MS",
        "BOOK_PROCESSING_RETRY_DELAY_MS",
        "BOOK_PROCESSING_STALE_LOCK_MS",
    ]);
    assertHasKeys(production, [
        "READER_DOMAIN",
        "POSTGRES_PASSWORD",
        "JWT_SECRET",
        "FRONTEND_URL",
        "NEXT_PUBLIC_API_URL",
        "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_ID",
        "OPENAI_API_KEY",
        "VECTOR_STORE_DRIVER",
        "STORAGE_DRIVER",
        "S3_BUCKET_NAME",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "BOOK_PROCESSING_RUNNER_ENABLED",
    ]);
    assert.deepEqual([...web.keys()].sort(), [
        "NEXT_PUBLIC_API_URL",
        "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
    ]);

    assert.equal(production.get("NEXT_PUBLIC_API_URL"), "");
    assert.equal(production.get("VECTOR_STORE_DRIVER"), "pg");
    assert.equal(production.get("STORAGE_DRIVER"), "s3");
    assert.equal(production.get("BOOK_PROCESSING_RUNNER_ENABLED"), "true");

    for (const values of [local, production, web]) {
        for (const forbidden of [
            "GOOGLE_CLIENT_SECRET",
            "RAG_EVAL_ENABLED",
            "RERANK_ENABLED",
            "SHADOW_RAG_ENABLED",
        ]) {
            assert.equal(values.has(forbidden), false, forbidden);
        }
    }
});

test("production topology remains same-origin and low-service", () => {
    const compose = read("docker-compose.prod.yml");
    const caddy = read("Caddyfile");

    assert.doesNotMatch(compose, /^\s{4}(redis|chroma):/m);
    assert.match(compose, /VECTOR_STORE_DRIVER: pg/);
    assert.match(compose, /BOOK_PROCESSING_RUNNER_ENABLED: "true"/);
    assert.match(compose, /127\.0\.0\.1:\$\{API_PORT:-3000\}/);
    assert.match(compose, /127\.0\.0\.1:\$\{WEB_PORT:-3001\}/);

    for (const route of ["/api/*", "/health", "/api-docs*"]) {
        assert.match(caddy, new RegExp(`handle ${route.replace("*", "\\*")}`));
    }
    assert.match(caddy, /reverse_proxy 127\.0\.0\.1:\$\{API_PORT\}/);
    assert.match(caddy, /reverse_proxy 127\.0\.0\.1:\$\{WEB_PORT\}/);
});
