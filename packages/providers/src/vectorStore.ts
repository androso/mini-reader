import OpenAI from "openai";
import { Pool } from "pg";
import { createLogger } from "./logger";

const log = createLogger("vectorStore");
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-ada-002";

export interface VectorStoreProvider {
    createCollection(name: string): Promise<any>;
    getOrCreateCollection(name: string): Promise<any>;
    addDocuments(collectionName: string, documents: string[]): Promise<void>;
    queryCollection(
        collectionName: string,
        query: string,
        nResults?: number
    ): Promise<any>;
    searchDocuments(
        collectionName: string,
        query: string,
        nResults?: number
    ): Promise<VectorSearchResult[]>;
    deleteCollection(name: string): Promise<boolean>;
    resetCollection(name: string): Promise<void>;
    getCollection(name: string): Promise<any | null>;
}

export interface VectorSearchResult {
    id: string;
    content: string;
    rank: number;
    distance?: number;
}

const parsePositiveIntegerEnv = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
};

const sleep = (delayMs: number) =>
    new Promise((resolve) => setTimeout(resolve, delayMs));

const getErrorDetail = (error: unknown) => {
    if (!error || typeof error !== "object") {
        return String(error);
    }

    const details = error as {
        code?: unknown;
        errno?: unknown;
        status?: unknown;
        type?: unknown;
        message?: unknown;
        name?: unknown;
    };

    return [
        details.name,
        details.code,
        details.errno,
        details.status,
        details.type,
        details.message,
    ]
        .filter(Boolean)
        .join(" ");
};

const isRetryableVectorStoreError = (error: unknown) => {
    const detail = getErrorDetail(error);

    return [
        "ERR_STREAM_PREMATURE_CLOSE",
        "Premature close",
        "Invalid response body",
        "ECONNRESET",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EAI_AGAIN",
        "ECONNREFUSED",
        "APIConnectionError",
        "APIConnectionTimeoutError",
        "429",
        "500",
        "502",
        "503",
        "504",
    ].some((retryable) => detail.includes(retryable));
};

const withRetry = async <T>(
    operation: () => Promise<T>,
    {
        attempts,
        delayMs,
        label,
    }: { attempts: number; delayMs: number; label: string }
) => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            if (!isRetryableVectorStoreError(error)) {
                throw error;
            }

            if (attempt === attempts) {
                break;
            }

            log.warn("Retrying after vector store error", {
                attempt,
                attempts,
                delayMs,
                label,
                error: getErrorDetail(error),
            });

            await sleep(delayMs);
        }
    }

    throw lastError;
};

const embeddingToPgVector = (embedding: number[]) => `[${embedding.join(",")}]`;

export class PgVectorStore implements VectorStoreProvider {
    private pool: Pool | null = null;
    private readonly openai: OpenAI;
    private readonly embeddingModel: string;

    constructor() {
        this.embeddingModel =
            process.env.OPENAI_EMBEDDING_MODEL ||
            DEFAULT_OPENAI_EMBEDDING_MODEL;

        const openAiOptions: NonNullable<
            ConstructorParameters<typeof OpenAI>[0]
        > = {
            apiKey: process.env.OPENAI_API_KEY || "",
            maxRetries: 0,
            defaultHeaders: {
                "Accept-Encoding": "identity",
            },
        };

        if (typeof globalThis.fetch === "function") {
            openAiOptions.fetch = globalThis.fetch.bind(
                globalThis
            ) as NonNullable<typeof openAiOptions.fetch>;
        }

        this.openai = new OpenAI(openAiOptions);

        log.info("Initialized Postgres vector store", {
            embeddingModel: this.embeddingModel,
            embeddingFetch:
                typeof globalThis.fetch === "function"
                    ? "globalThis.fetch"
                    : "openai-sdk-default",
            embeddingAcceptEncoding: "identity",
        });
    }

    private getPool() {
        if (!this.pool) {
            if (!process.env.DATABASE_URL) {
                throw new Error(
                    "Missing required DATABASE_URL environment variable"
                );
            }
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
            });
        }

        return this.pool;
    }

    async createCollection(name: string): Promise<{ name: string }> {
        log.debug("Postgres vector collections are row-scoped", { name });
        return { name };
    }

    async getOrCreateCollection(name: string): Promise<{ name: string }> {
        return this.createCollection(name);
    }

    async getCollection(name: string): Promise<{ name: string } | null> {
        const result = await this.getPool().query(
            `
                SELECT 1
                FROM book_search_chunks
                WHERE collection_name = $1
                LIMIT 1
            `,
            [name]
        );
        return result.rowCount ? { name } : null;
    }

    async resetCollection(name: string): Promise<void> {
        log.info("Resetting Postgres vector collection", { name });
        await this.getPool().query(
            "DELETE FROM book_search_chunks WHERE collection_name = $1",
            [name]
        );
    }

    async addDocuments(collectionName: string, documents: string[]) {
        const start = Date.now();
        const validDocuments = documents
            .map((content, chunkIndex) => ({ content, chunkIndex }))
            .filter(
                (document) =>
                    document.content &&
                    document.content.length > 0 &&
                    document.content.length < 4000
            );
        const invalidCount = documents.length - validDocuments.length;
        if (invalidCount > 0) {
            log.warn("Filtered invalid documents", {
                collectionName,
                invalidCount,
                totalCount: documents.length,
            });
        }

        const batchSize = parsePositiveIntegerEnv(
            "VECTOR_STORE_BATCH_SIZE",
            50
        );
        const batchRetryAttempts = parsePositiveIntegerEnv(
            "VECTOR_STORE_BATCH_RETRY_ATTEMPTS",
            4
        );
        const batchRetryDelayMs = parsePositiveIntegerEnv(
            "VECTOR_STORE_BATCH_RETRY_DELAY_MS",
            1000
        );

        for (let i = 0; i < validDocuments.length; i += batchSize) {
            const batchDocuments = validDocuments.slice(i, i + batchSize);
            const batchContent = batchDocuments.map(
                (document) => document.content
            );
            const embeddings = await withRetry(
                () =>
                    this.createEmbeddings(batchContent, {
                        collectionName,
                        batchIndex: i / batchSize,
                    }),
                {
                    attempts: batchRetryAttempts,
                    delayMs: batchRetryDelayMs,
                    label: `OpenAI embeddings for ${collectionName} batch ${
                        i / batchSize
                    }`,
                }
            );

            await withRetry(
                () =>
                    this.upsertBatch(
                        collectionName,
                        batchDocuments,
                        embeddings
                    ),
                {
                    attempts: batchRetryAttempts,
                    delayMs: batchRetryDelayMs,
                    label: `Postgres vector upsert for ${collectionName} batch ${
                        i / batchSize
                    }`,
                }
            );
        }

        log.info("Documents added to Postgres vector store", {
            collectionName,
            documentCount: validDocuments.length,
            durationMs: Date.now() - start,
        });
    }

    private async upsertBatch(
        collectionName: string,
        documents: { content: string; chunkIndex: number }[],
        embeddings: number[][]
    ) {
        const client = await this.getPool().connect();
        try {
            await client.query("BEGIN");
            for (let index = 0; index < documents.length; index += 1) {
                const document = documents[index];
                await client.query(
                    `
                        INSERT INTO book_search_chunks (
                            id,
                            collection_name,
                            chunk_index,
                            content,
                            embedding
                        )
                        VALUES ($1, $2, $3, $4, $5::vector)
                        ON CONFLICT (collection_name, chunk_index) DO UPDATE
                        SET
                            content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding
                    `,
                    [
                        `${collectionName}_${document.chunkIndex}`,
                        collectionName,
                        document.chunkIndex,
                        document.content,
                        embeddingToPgVector(embeddings[index]),
                    ]
                );
            }
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    private async createEmbeddings(
        input: string[],
        context: { collectionName: string; batchIndex?: number }
    ): Promise<number[][]> {
        const start = Date.now();
        log.info("Creating OpenAI embeddings", {
            ...context,
            inputCount: input.length,
            model: this.embeddingModel,
        });

        const { data: response, request_id: requestId } =
            await this.openai.embeddings
                .create({
                    model: this.embeddingModel,
                    input,
                    encoding_format: "float",
                })
                .withResponse();

        const embeddings = response.data.map(
            (item: { embedding: number[] }) => item.embedding
        );
        if (embeddings.length !== input.length) {
            throw new Error(
                `OpenAI returned ${embeddings.length} embeddings for ${input.length} inputs`
            );
        }

        log.info("OpenAI embeddings created", {
            ...context,
            inputCount: input.length,
            requestId,
            promptTokens: response.usage?.prompt_tokens,
            totalTokens: response.usage?.total_tokens,
            durationMs: Date.now() - start,
        });

        return embeddings;
    }

    async queryCollection(collectionName: string, query: string, nResults = 3) {
        const [queryEmbedding] = await this.createEmbeddings([query], {
            collectionName,
            batchIndex: 0,
        });
        const results = await this.getPool().query<{
            id: string;
            content: string;
            distance: number;
        }>(
            `
                SELECT
                    id,
                    content,
                    embedding <=> $2::vector AS distance
                FROM book_search_chunks
                WHERE collection_name = $1
                  AND embedding IS NOT NULL
                ORDER BY embedding <=> $2::vector
                LIMIT $3
            `,
            [collectionName, embeddingToPgVector(queryEmbedding), nResults]
        );

        return {
            ids: [results.rows.map((row) => row.id)],
            documents: [results.rows.map((row) => row.content)],
            distances: [results.rows.map((row) => Number(row.distance))],
        };
    }

    async searchDocuments(
        collectionName: string,
        query: string,
        nResults = 20
    ): Promise<VectorSearchResult[]> {
        const start = Date.now();
        const results = await this.queryCollection(
            collectionName,
            query,
            nResults
        );
        const ids = results.ids[0] || [];
        const documents = results.documents[0] || [];
        const distances = results.distances[0] || [];

        const mapped = documents.map((content, index) => ({
            id: ids[index] || `${collectionName}_${index}`,
            content,
            rank: index + 1,
            distance: distances[index],
        }));

        log.info("Postgres vector search complete", {
            collectionName,
            nResults,
            returnedCount: mapped.length,
            durationMs: Date.now() - start,
        });
        return mapped;
    }

    async deleteCollection(name: string): Promise<boolean> {
        await this.getPool().query(
            "DELETE FROM book_search_chunks WHERE collection_name = $1",
            [name]
        );
        return true;
    }
}

export const vectorStore: VectorStoreProvider = new PgVectorStore();
