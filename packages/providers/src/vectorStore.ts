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
        const batchSize = 75;
        const concurrentBatches = 8;
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
                allBatches
                    .slice(i, i + concurrentBatches)
                    .map((batchData) => collection.upsert(batchData))
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
