import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import { PgVectorStore } from "../src/vectorStore";

const embedding = (...values: number[]) => values;

const createPoolMock = (options?: {
    queryImpl?: (
        sql: string,
        params?: unknown[]
    ) => Promise<Partial<QueryResult>>;
    clientQueryImpl?: (
        sql: string,
        params?: unknown[]
    ) => Promise<Partial<QueryResult>>;
}) => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const clientQueries: Array<{ sql: string; params?: unknown[] }> = [];
    let released = false;

    const client = {
        query: async (sql: string, params?: unknown[]) => {
            clientQueries.push({ sql, params });
            if (options?.clientQueryImpl) {
                return options.clientQueryImpl(sql, params);
            }
            return { rowCount: 0, rows: [] };
        },
        release: () => {
            released = true;
        },
    } as unknown as PoolClient;

    const pool = {
        query: async (sql: string, params?: unknown[]) => {
            queries.push({ sql, params });
            if (options?.queryImpl) {
                return options.queryImpl(sql, params);
            }
            return { rowCount: 0, rows: [] };
        },
        connect: async () => client,
    } as unknown as Pool;

    return { pool, queries, clientQueries, getReleased: () => released };
};

const withRetryEnv = async <T>(
    env: Record<string, string>,
    run: () => Promise<T>
) => {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(env)) {
        previous.set(key, process.env[key]);
        process.env[key] = value;
    }

    try {
        return await run();
    } finally {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
};

test("addDocuments filters invalid and empty documents", async () => {
    const embedCalls: string[][] = [];
    const { pool, clientQueries } = createPoolMock();
    const store = new PgVectorStore({
        pool,
        embeddingModel: "test-model",
        embed: async (input) => {
            embedCalls.push([...input]);
            return input.map((_, index) => embedding(index + 1));
        },
    });

    await store.addDocuments("collection", [
        "",
        "valid one",
        "   ",
        "x".repeat(4000),
        "valid two",
    ]);

    assert.deepEqual(embedCalls, [["valid one", "   ", "valid two"]]);
    assert.equal(
        clientQueries.filter((entry) => entry.sql.includes("INSERT INTO"))
            .length,
        3
    );
});

test("addDocuments batches embeddings by VECTOR_STORE_BATCH_SIZE", async () => {
    const embedCalls: string[][] = [];
    const { pool } = createPoolMock();
    const store = new PgVectorStore({
        pool,
        embed: async (input) => {
            embedCalls.push([...input]);
            return input.map(() => embedding(1, 2));
        },
    });

    await withRetryEnv({ VECTOR_STORE_BATCH_SIZE: "2" }, async () => {
        await store.addDocuments("batched", ["a", "b", "c", "d", "e"]);
    });

    assert.deepEqual(embedCalls, [["a", "b"], ["c", "d"], ["e"]]);
});

test("addDocuments retries retryable embed errors and fails fast otherwise", async () => {
    const { pool } = createPoolMock();
    let retryableAttempts = 0;
    const retryableStore = new PgVectorStore({
        pool,
        embed: async (input) => {
            retryableAttempts += 1;
            if (retryableAttempts < 3) {
                const error = new Error("temporary");
                (error as { code?: string }).code = "ECONNRESET";
                throw error;
            }
            return input.map(() => embedding(1));
        },
    });

    await withRetryEnv(
        {
            VECTOR_STORE_BATCH_RETRY_ATTEMPTS: "4",
            VECTOR_STORE_BATCH_RETRY_DELAY_MS: "1",
        },
        async () => {
            await retryableStore.addDocuments("retryable", ["doc"]);
        }
    );
    assert.equal(retryableAttempts, 3);

    let nonRetryableAttempts = 0;
    const nonRetryableStore = new PgVectorStore({
        pool,
        embed: async () => {
            nonRetryableAttempts += 1;
            throw new Error("Invalid API key");
        },
    });

    await assert.rejects(
        () =>
            withRetryEnv(
                {
                    VECTOR_STORE_BATCH_RETRY_ATTEMPTS: "4",
                    VECTOR_STORE_BATCH_RETRY_DELAY_MS: "1",
                },
                async () =>
                    nonRetryableStore.addDocuments("non-retryable", ["doc"])
            ),
        /Invalid API key/
    );
    assert.equal(nonRetryableAttempts, 1);
});

test("upsertBatch commits on success and rolls back on failure", async () => {
    const success = createPoolMock();
    const successStore = new PgVectorStore({
        pool: success.pool,
        embed: async (input) => input.map(() => embedding(0.1, 0.2)),
    });

    await successStore.addDocuments("commit-me", ["alpha"]);
    assert.equal(
        success.clientQueries.some((entry) => entry.sql === "BEGIN"),
        true
    );
    assert.equal(
        success.clientQueries.some((entry) => entry.sql === "COMMIT"),
        true
    );
    assert.equal(
        success.clientQueries.some((entry) => entry.sql === "ROLLBACK"),
        false
    );
    assert.equal(success.getReleased(), true);

    const failure = createPoolMock({
        clientQueryImpl: async (sql) => {
            if (sql.includes("INSERT INTO")) {
                throw new Error("insert failed");
            }
            return { rowCount: 0, rows: [] };
        },
    });
    const failureStore = new PgVectorStore({
        pool: failure.pool,
        embed: async (input) => input.map(() => embedding(0.3)),
    });

    await assert.rejects(
        () =>
            withRetryEnv(
                {
                    VECTOR_STORE_BATCH_RETRY_ATTEMPTS: "1",
                    VECTOR_STORE_BATCH_RETRY_DELAY_MS: "1",
                },
                async () => failureStore.addDocuments("rollback-me", ["beta"])
            ),
        /insert failed/
    );
    assert.equal(
        failure.clientQueries.some((entry) => entry.sql === "BEGIN"),
        true
    );
    assert.equal(
        failure.clientQueries.some((entry) => entry.sql === "ROLLBACK"),
        true
    );
    assert.equal(
        failure.clientQueries.some((entry) => entry.sql === "COMMIT"),
        false
    );
    assert.equal(failure.getReleased(), true);
});

test("collection lookup, reset, and delete use the injected pool", async () => {
    const { pool, queries } = createPoolMock({
        queryImpl: async (sql) => {
            if (sql.includes("SELECT 1")) {
                return { rowCount: 1, rows: [{ "?column?": 1 }] };
            }
            return { rowCount: 2, rows: [] };
        },
    });
    const store = new PgVectorStore({ pool });

    assert.deepEqual(await store.getCollection("present"), { name: "present" });
    await store.resetCollection("present");
    assert.equal(await store.deleteCollection("present"), true);

    const emptyLookup = createPoolMock({
        queryImpl: async () => ({ rowCount: 0, rows: [] }),
    });
    assert.equal(
        await new PgVectorStore({ pool: emptyLookup.pool }).getCollection(
            "missing"
        ),
        null
    );

    assert.equal(
        queries.filter((entry) => entry.sql.includes("book_search_chunks"))
            .length,
        3
    );
    assert.deepEqual(queries[0]?.params, ["present"]);
    assert.deepEqual(queries[1]?.params, ["present"]);
    assert.deepEqual(queries[2]?.params, ["present"]);
});

test("searchDocuments preserves ordering and maps ranks", async () => {
    const { pool } = createPoolMock({
        queryImpl: async () => ({
            rowCount: 2,
            rows: [
                { id: "c_0", content: "first", distance: 0.1 },
                { id: "c_1", content: "second", distance: 0.2 },
            ],
        }),
    });
    const store = new PgVectorStore({
        pool,
        embed: async () => [embedding(1, 0, 0)],
    });

    const results = await store.searchDocuments("c", "query", 2);
    assert.deepEqual(results, [
        { id: "c_0", content: "first", rank: 1, distance: 0.1 },
        { id: "c_1", content: "second", rank: 2, distance: 0.2 },
    ]);
});

test("createEmbeddings rejects embedding count mismatches for injected embed", async () => {
    const { pool } = createPoolMock();
    const store = new PgVectorStore({
        pool,
        embed: async () => [embedding(1)],
    });

    await assert.rejects(
        () =>
            withRetryEnv(
                {
                    VECTOR_STORE_BATCH_RETRY_ATTEMPTS: "1",
                    VECTOR_STORE_BATCH_RETRY_DELAY_MS: "1",
                },
                async () => store.addDocuments("mismatch", ["one", "two"])
            ),
        /OpenAI returned 1 embeddings for 2 inputs/
    );
});

test("createCollection and getOrCreateCollection are name-scoped", async () => {
    const store = new PgVectorStore({
        pool: createPoolMock().pool,
        embed: async () => [],
    });

    assert.deepEqual(await store.createCollection("alpha"), { name: "alpha" });
    assert.deepEqual(await store.getOrCreateCollection("beta"), {
        name: "beta",
    });
});
