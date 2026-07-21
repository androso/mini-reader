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
    assert.equal(production.get("STORAGE_DRIVER"), "s3");
    assert.equal(production.get("BOOK_PROCESSING_RUNNER_ENABLED"), "true");

    for (const values of [local, production, web]) {
        for (const forbidden of [
            "GOOGLE_CLIENT_SECRET",
            "RAG_EVAL_ENABLED",
            "RERANK_ENABLED",
            "SHADOW_RAG_ENABLED",
            "API_PORT",
            "WEB_PORT",
            "VECTOR_STORE_DRIVER",
            "VECTOR_STORE_CONCURRENT_BATCHES",
            "BOOK_PROCESSING_CONCURRENCY",
        ]) {
            assert.equal(values.has(forbidden), false, forbidden);
        }
    }
});

test("production topology remains same-origin and low-service", () => {
    const compose = read("docker-compose.prod.yml");
    const caddy = read("Caddyfile");

    assert.doesNotMatch(compose, /^\s{4}(redis|chroma):/m);
    assert.match(compose, /image:\s*caddy:2\.11\.4-alpine/);
    assert.match(compose, /STORAGE_DRIVER: s3/);
    assert.match(compose, /BOOK_PROCESSING_RUNNER_ENABLED: "true"/);
    assert.doesNotMatch(compose, /VECTOR_STORE_DRIVER/);
    assert.doesNotMatch(
        compose,
        /API_PORT|WEB_PORT|BOOK_PROCESSING_CONCURRENCY/
    );
    assert.doesNotMatch(compose, /ports:\s*\n\s*-\s*"127\.0\.0\.1/);

    assert.match(caddy, /reverse_proxy app:3000/);
    assert.doesNotMatch(caddy, /handle \/(api|health|api-docs)/);
});

test("production docs constrain the interpolated Postgres password", () => {
    const documents = [
        read(".env.prod.example"),
        read("docs/aws-lightsail-deploy.md"),
        read("docs/aws-lightsail-cloudformation-deploy.md"),
    ];

    for (const document of documents) {
        assert.match(document, /URI-unreserved/);
        for (const allowed of ["A-Z", "a-z", "0-9"]) {
            assert.match(document, new RegExp(allowed));
        }
        for (const reserved of ["/", "?", "#", "@", ":"]) {
            assert.match(document, new RegExp(`\\${reserved}`));
        }
    }
});
