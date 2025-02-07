import { ChromaClient, OpenAIEmbeddingFunction } from "chromadb";
import dotenv from "dotenv";

dotenv.config();

export class ChromaService {
    private client: ChromaClient;
    private embeddingFunction: OpenAIEmbeddingFunction;
    private collections: Map<
        string,
        { name: string; collection: any; lastAccessed: number }
    > = new Map();
    private static instance: ChromaService;

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
        this.collections = new Map();

        setInterval(() => this.cleanUpCache(), 1800000);
    }

    public static getInstance() {
        if (!ChromaService.instance) {
            ChromaService.instance = new ChromaService();
        }
        return ChromaService.instance;
    }
    private cleanUpCache(): void {
        const now = Date.now();
        const CACHETTL = 3600000;
        for (const [name, data] of this.collections.entries()) {
            if (now - data.lastAccessed > CACHETTL) {
                this.collections.delete(name);
                console.log(`Collection ${name} removed from cache`);
            }
        }
    }

    async getCollection(name: string) {
        try {
            // Check cache first
            const cachedCollection = this.collections.get(name);
            if (cachedCollection) {
                console.log(`Cache hit for collection: ${name}`);
                // Update last accessed time
                cachedCollection.lastAccessed = Date.now();
                return cachedCollection.collection;
            }

            console.log(
                `Cache miss for collection: ${name}, fetching from ChromaDB`
            );
            const collection = await this.client.getCollection({
                name,
                embeddingFunction: this.embeddingFunction,
            });

            // Store in cache
            this.collections.set(name, {
                name: name,
                collection: collection,
                lastAccessed: Date.now(),
            });

            return collection;
        } catch (error) {
            return null;
        }
    }

    async createCollection(name: string) {
        try {
            const collection = await this.client.createCollection({
                name,
                embeddingFunction: this.embeddingFunction,
            });
            console.log(
                `Created collection: ${name} with ID: ${collection.id}`
            );

            this.collections.set(name, {
                name: name,
                collection: collection,
                lastAccessed: Date.now(),
            });
            return collection;
        } catch (error) {
            console.error("Error creating collection:", error);
            throw error;
        }
    }

    async getOrCreateCollection(name: string) {
        try {
            const existingCollection = await this.getCollection(name);
            if (existingCollection) return existingCollection;
            return await this.createCollection(name);
        } catch (error) {
            console.error("Error in getOrCreateCollection:", error);
            throw error;
        }
    }

    async addDocuments(collectionName: string, documents: string[]) {
        try {
            const collection = await this.getOrCreateCollection(collectionName);
            console.log(
                `[ChromaService]Using collection: ${collectionName} with ID: ${collection.id}`
            );

            // Pre-filter all documents
            const validDocuments = documents.filter(
                (doc) => doc && doc.length > 0 && doc.length < 4000
            );

            // Increased batch size and concurrency for faster processing
            const BATCH_SIZE = 75;
            const CONCURRENT_BATCHES = 8; // Number of concurrent requests

            // Pre-generate IDs and metadata to reduce overhead
            const timestamp = Date.now();
            const allBatches = [];

            for (let i = 0; i < validDocuments.length; i += BATCH_SIZE) {
                const batchDocuments = validDocuments.slice(i, i + BATCH_SIZE);
                const batchData = {
                    ids: batchDocuments.map(
                        (_, idx) => `doc_${timestamp}_${i + idx}`
                    ),
                    documents: batchDocuments,
                    metadatas: batchDocuments.map(() => ({ timestamp })),
                };
                allBatches.push(batchData);
            }

            // Process batches with controlled concurrency
            const results = [];
            for (let i = 0; i < allBatches.length; i += CONCURRENT_BATCHES) {
                const batchPromises = allBatches
                    .slice(i, i + CONCURRENT_BATCHES)
                    .map(async (batchData, batchIndex) => {
                        const currentBatch = i + batchIndex + 1;
                        console.log(
                            `Processing batch ${currentBatch}/${allBatches.length}`
                        );

                        // Add exponential backoff retry logic
                        const maxRetries = 3;
                        let lastError;
                        for (let retry = 0; retry < maxRetries; retry++) {
                            try {
                                if (retry > 0) {
                                    const delay = Math.min(
                                        1000 * Math.pow(2, retry),
                                        10000
                                    );
                                    await new Promise((resolve) =>
                                        setTimeout(resolve, delay)
                                    );
                                    console.log(
                                        `Retry ${retry + 1} for batch ${currentBatch}`
                                    );
                                }

                                const startTime = Date.now();
                                await collection.add(batchData);
                                const duration = Date.now() - startTime;

                                console.log(
                                    `Batch ${currentBatch} completed in ${duration}ms`
                                );
                                return { success: true, batch: currentBatch };
                            } catch (error) {
                                lastError = error;
                                if (retry === maxRetries - 1) throw error;
                            }
                        }
                    });

                // Wait for the current group of batches to complete
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
            }

            const totalSuccess = results.filter((r) => r?.success).length;
            console.log(
                `Completed ${totalSuccess}/${allBatches.length} batches successfully`
            );
        } catch (error) {
            console.error("ChromaDB Add Error:", {
                collectionName,
                batchInfo: {
                    total: documents.length,
                    first: documents[0]?.length,
                },
                error: error instanceof Error ? error.stack : String(error),
            });
            throw error;
        }
    }

    async queryCollection(collectionName: string, query: string, nResults = 3) {
        const collection = await this.getOrCreateCollection(collectionName);
        return await collection.query({
            queryTexts: [query],
            nResults,
        });
    }

    async deleteCollection(name: string): Promise<boolean> {
        try {
            await this.client.deleteCollection({ name });
            this.collections.delete(name);
            console.log(`Collection deleted: ${name}`);
            return true;
        } catch (error) {
            console.error("Delete collection error:", error);
            throw error;
        }
    }
}
export const chromaService = ChromaService.getInstance();
