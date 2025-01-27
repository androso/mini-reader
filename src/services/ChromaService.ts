import { ChromaClient, OpenAIEmbeddingFunction } from "chromadb";
import dotenv from "dotenv";

dotenv.config();

export class ChromaService {
    private client: ChromaClient;
    private embeddingFunction: OpenAIEmbeddingFunction;
    private collections: Map<string, string> = new Map();

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
    }

    async getCollection(name: string) {
        try {
            const collection = await this.client.getCollection({
                name,
                embeddingFunction: this.embeddingFunction,
            });
            console.log(`Found collection: ${name} with ID: ${collection.id}`);
            this.collections.set(name, collection.id);
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
            this.collections.set(name, collection.id);
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
                `Using collection: ${collectionName} with ID: ${collection.id}`
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

    async createEmbedding(text: string): Promise<number[]> {
        try {
            const response = await this.embeddingFunction.generate([text]);

            if (!response || !response[0]) {
                throw new Error("Failed to generate embedding");
            }

            return response[0];
        } catch (error) {
            throw new Error(`Embedding generation failed: ${error}`);
        }
    }

    async storeDocumentsChunks(
        pdfId: string,
        chunks: string[],
        embeddings: number[][]
    ) {
        if (chunks.length !== embeddings.length) {
            throw new Error("Number of chunks and embeddings must match");
        }

        if (!chunks.length) {
            throw new Error("No chunks provided");
        }

        try {
            const collection = await this.getOrCreateCollection(pdfId);

            const documents = chunks.map((chunk, index) => ({
                id: `${pdfId}_${index}`,
                embedding: embeddings[index],
                metadata: { pdfId },
                content: chunk,
            }));

            await collection.add({
                ids: documents.map((doc) => doc.id),
                embeddings: documents.map((doc) => doc.embedding),
                metadatas: documents.map((doc) => doc.metadata),
                documents: documents.map((doc) => doc.content),
            });
        } catch (error) {
            throw new Error(`Failed to store document chunks: ${error}`);
        }
    }
    async searchSimilarChunks(
        collectionName: string,
        embedding: number[],
        topK = 5
    ) {
        if (topK < 1) {
            throw new Error("topK must be greater than 0");
        }

        try {
            const collection = await this.client.getCollection({
                name: collectionName,
                embeddingFunction: this.embeddingFunction,
            });

            if (!collection) {
                throw new Error(`Collection ${collectionName} not found`);
            }

            const results = await collection.query({
                queryEmbeddings: [embedding],
                nResults: topK,
                where: { collection: collectionName },
            });

            return results;
        } catch (error) {
            throw new Error(`Search failed: ${error}`);
        }
    }
}
