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

  async getOrCreateCollection(name: string) {
    try {
      let collection;
      try {
        collection = await this.client.getCollection({
          name,
          embeddingFunction: this.embeddingFunction,
        });
        console.log(`Found collection: ${name} with ID: ${collection.id}`);
      } catch (error) {
        collection = await this.client.createCollection({
          name,
          embeddingFunction: this.embeddingFunction,
        });
        console.log(`Created collection: ${name} with ID: ${collection.id}`);
      }
      // Cache collection ID for future use (avoiding repeated API calls)
      this.collections.set(name, collection.id);
      return collection;
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
          ids: batchDocuments.map((_, idx) => `doc_${timestamp}_${i + idx}`),
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
                  const delay = Math.min(1000 * Math.pow(2, retry), 10000);
                  await new Promise((resolve) => setTimeout(resolve, delay));
                  console.log(`Retry ${retry + 1} for batch ${currentBatch}`);
                }

                const startTime = Date.now();
                await collection.add(batchData);
                const duration = Date.now() - startTime;

                console.log(`Batch ${currentBatch} completed in ${duration}ms`);
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
        batchInfo: { total: documents.length, first: documents[0]?.length },
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
