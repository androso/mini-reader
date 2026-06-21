import { ChromaClient, OpenAIEmbeddingFunction } from "chromadb";

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
            if (attempt >= attempts || !isRetryableVectorStoreError(error)) {
                throw error;
            }

            const retryDelayMs = delayMs * 2 ** (attempt - 1);
            console.warn(
                `${label} failed on attempt ${attempt}; retrying in ${retryDelayMs}ms`,
                error
            );
            await sleep(retryDelayMs);
        }
    }

    throw lastError;
};

export class ChromaVectorStore implements VectorStoreProvider {
    private readonly client: ChromaClient;
    private readonly embeddingFunction: OpenAIEmbeddingFunction;
    private readonly collections = new Map<
        string,
        { name: string; collection: any; lastAccessed: number }
    >();

    constructor() {
        this.client = new ChromaClient({
            path: process.env.CHROMA_URL || "http://localhost:8000",
            auth: {
                provider: "basic",
                credentials: process.env.CHROMA_CLIENT_AUTH_CREDENTIALS || "",
            },
        });

        this.embeddingFunction = new OpenAIEmbeddingFunction({
            openai_api_key: process.env.OPENAI_API_KEY || "",
            openai_model: "text-embedding-ada-002",
        });

        setInterval(() => this.cleanUpCache(), 1800000).unref();
    }

    private cleanUpCache(): void {
        const now = Date.now();
        const cacheTtl = 3600000;
        for (const [name, data] of this.collections.entries()) {
            if (now - data.lastAccessed > cacheTtl) {
                this.collections.delete(name);
            }
        }
    }

    async getCollection(name: string) {
        try {
            const cachedCollection = this.collections.get(name);
            if (cachedCollection) {
                cachedCollection.lastAccessed = Date.now();
                return cachedCollection.collection;
            }

            const collection = await this.client.getCollection({
                name,
                embeddingFunction: this.embeddingFunction,
            });

            this.collections.set(name, {
                name,
                collection,
                lastAccessed: Date.now(),
            });
            return collection;
        } catch {
            return null;
        }
    }

    async createCollection(name: string): Promise<any> {
        const collection = await this.client.createCollection({
            name,
            embeddingFunction: this.embeddingFunction,
        });
        this.collections.set(name, {
            name,
            collection,
            lastAccessed: Date.now(),
        });
        return collection;
    }

    async getOrCreateCollection(name: string): Promise<any> {
        const existingCollection = await this.getCollection(name);
        if (existingCollection) return existingCollection;
        return this.createCollection(name);
    }

    async resetCollection(name: string) {
        try {
            await this.client.deleteCollection({ name });
        } catch {
            // Missing collections are already reset.
        }
        this.collections.delete(name);
        await this.createCollection(name);
    }

    async addDocuments(collectionName: string, documents: string[]) {
        const collection = await this.getOrCreateCollection(collectionName);
        const validDocuments = documents.filter(
            (doc) => doc && doc.length > 0 && doc.length < 4000
        );
        const batchSize = parsePositiveIntegerEnv(
            "VECTOR_STORE_BATCH_SIZE",
            50
        );
        const concurrentBatches = parsePositiveIntegerEnv(
            "VECTOR_STORE_CONCURRENT_BATCHES",
            2
        );
        const batchRetryAttempts = parsePositiveIntegerEnv(
            "VECTOR_STORE_BATCH_RETRY_ATTEMPTS",
            4
        );
        const batchRetryDelayMs = parsePositiveIntegerEnv(
            "VECTOR_STORE_BATCH_RETRY_DELAY_MS",
            1000
        );
        const allBatches = [];

        for (let i = 0; i < validDocuments.length; i += batchSize) {
            const batchDocuments = validDocuments.slice(i, i + batchSize);
            allBatches.push({
                ids: batchDocuments.map(
                    (_, idx) => `${collectionName}_${i + idx}`
                ),
                documents: batchDocuments,
                metadatas: batchDocuments.map((_, idx) => ({
                    collectionName,
                    chunkIndex: i + idx,
                })),
            });
        }

        for (let i = 0; i < allBatches.length; i += concurrentBatches) {
            await Promise.all(
                allBatches.slice(i, i + concurrentBatches).map((batchData) =>
                    withRetry(() => collection.upsert(batchData), {
                        attempts: batchRetryAttempts,
                        delayMs: batchRetryDelayMs,
                        label: `Vector upsert for ${collectionName}`,
                    })
                )
            );
        }
    }

    async queryCollection(collectionName: string, query: string, nResults = 3) {
        const collection = await this.getOrCreateCollection(collectionName);
        return collection.query({
            queryTexts: [query],
            nResults,
        });
    }

    async searchDocuments(
        collectionName: string,
        query: string,
        nResults = 20
    ): Promise<VectorSearchResult[]> {
        const results = await this.queryCollection(
            collectionName,
            query,
            nResults
        );
        const ids = results.ids?.[0] || [];
        const documents = results.documents?.[0] || [];
        const distances = results.distances?.[0] || [];

        return documents
            .map((content: string | null, index: number) => {
                if (!content) return null;
                return {
                    id: ids[index] || `${collectionName}_${index}`,
                    content,
                    rank: index + 1,
                    distance: distances[index],
                };
            })
            .filter(Boolean) as VectorSearchResult[];
    }

    async deleteCollection(name: string): Promise<boolean> {
        await this.client.deleteCollection({ name });
        this.collections.delete(name);
        return true;
    }
}

export const vectorStore: VectorStoreProvider = new ChromaVectorStore();
