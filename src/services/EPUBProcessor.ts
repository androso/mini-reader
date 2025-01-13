// src/services/EPUBProcessor.ts
import { S3Service } from "./S3Services";
import { ChromaService } from "./ChromaService";
import { OpenAIService } from "./OpenAIServices";
import { readFile } from "fs/promises";
import EPub from "epub";
import { JSDOM } from "jsdom";
import { QueryResponse } from "../types";
import * as path from "path";
import { unlink } from "fs/promises";
import { LLMChunker } from "../utils/LlmChunks";
import { extractMetadata, createHash } from "../utils/bookUtils";

export class EPUBProcessor {
  private s3Service: S3Service;
  private chromaService: ChromaService;
  private openAIService: OpenAIService;
  private localFilePath: string;

  constructor(bucketName: string) {
    // Initialize services
    this.s3Service = new S3Service(bucketName);
    this.chromaService = new ChromaService();
    this.openAIService = new OpenAIService();
    this.localFilePath = path.join(__dirname, "../../temp_epub_file.epub");
  }

  private async extractTextFromEpub(): Promise<string[]> {
    console.log("[extractTextFromEpub] Starting EPUB text extraction");
    return new Promise((resolve, reject) => {
      const epub = new EPub(this.localFilePath);
      const llmChunker = new LLMChunker();

      epub.on("end", async () => {
        try {
          console.log(
            `[extractTextFromEpub] EPUB parsed, found ${epub.flow.length} chapters`
          );
          const allChapters: string[] = [];

          for (let i = 0; i < epub.flow.length; i++) {
            console.log(
              `[extractTextFromEpub] Processing chapter ${i + 1}/${
                epub.flow.length
              }`
            );

            const chapter = await new Promise<string>((resolveChapter) => {
              epub.getChapter(
                epub.flow[i].id,
                async (error: Error, text: string) => {
                  if (error) {
                    console.error(
                      `[extractTextFromEpub] Error reading chapter ${i}:`,
                      error
                    );
                    resolveChapter("");
                  } else {
                    try {
                      console.log(
                        `[extractTextFromEpub] Successfully read chapter ${
                          i + 1
                        }, length: ${text.length}`
                      );
                      const dom = new JSDOM(text);
                      const textContent =
                        dom.window.document.body.textContent || "";
                      const cleanContent = textContent
                        .replace(/\s+/g, " ")
                        .trim();
                      console.log(
                        `[extractTextFromEpub] Cleaned chapter ${
                          i + 1
                        }, length: ${cleanContent.length}`
                      );
                      resolveChapter(cleanContent);
                    } catch (parseError) {
                      console.error(
                        `[extractTextFromEpub] Error parsing chapter ${i}:`,
                        parseError
                      );
                      resolveChapter("");
                    }
                  }
                }
              );
            });

            if (chapter.trim()) {
              try {
                console.log(
                  `[extractTextFromEpub] Starting chunking for chapter ${i + 1}`
                );
                const chunks = await llmChunker.chunkText(chapter);
                console.log(
                  `[extractTextFromEpub] Chapter ${i + 1} chunked into ${
                    chunks.length
                  } parts`
                );
                allChapters.push(...chunks);
              } catch (chunkError) {
                console.error(
                  `[extractTextFromEpub] Error chunking chapter ${i}:`,
                  chunkError
                );
                if (chapter.length <= 8000) {
                  allChapters.push(chapter);
                  console.log(
                    `[extractTextFromEpub] Added chapter ${
                      i + 1
                    } as single chunk`
                  );
                }
              }
            }
          }

          console.log(
            `[extractTextFromEpub] Completed. Total chunks: ${allChapters.length}`
          );
          resolve(allChapters);
        } catch (error) {
          console.error("[extractTextFromEpub] Fatal error:", error);
          reject(error);
        }
      });

      epub.parse();
      console.log("[extractTextFromEpub] Started EPUB parsing");
    });
  }

  // Process EPUB file and add to ChromaDB collection
  private async processEpub(collectionName: string): Promise<boolean> {
    console.log("[processEpub] Starting EPUB processing");
    try {
      console.log("[processEpub] Extracting text from EPUB");
      const chunks = await this.extractTextFromEpub();
      console.log(`[processEpub] Extracted ${chunks.length} initial chunks`);

      const validChunks = chunks
        .filter((chunk) => chunk && chunk.length > 0)
        .map((chunk) => chunk.slice(0, 8000));

      console.log({
        stage: "processEpub",
        totalChunks: chunks.length,
        validChunks: validChunks.length,
        averageChunkLength:
          validChunks.reduce((acc, chunk) => acc + chunk.length, 0) /
          validChunks.length,
        smallestChunk: Math.min(...validChunks.map((c) => c.length)),
        largestChunk: Math.max(...validChunks.map((c) => c.length)),
      });

      if (!validChunks.length) {
        console.error("[processEpub] No valid chunks extracted");
        throw new Error("No valid text chunks extracted");
      }

      console.log("[processEpub] Adding chunks to ChromaDB");
      await this.chromaService.addDocuments(collectionName, validChunks);
      console.log("[processEpub] Successfully added chunks to ChromaDB");
      return true;
    } catch (error) {
      console.error("[processEpub] Error:", error);
      return false;
    }
  }

  async deleteCollection(name: string): Promise<boolean> {
    try {
      await this.chromaService.deleteCollection(name);
      return true;
    } catch (error) {
      console.error("Delete collection error:", error);
      return false;
    }
  }
  
  async getCollectionNameFromEpub(epubBuffer: Buffer): Promise<string> {
    try {
      const metadata = await extractMetadata(epubBuffer);
      const collectionHash = createHash(metadata);
      const collectionName = `book_${collectionHash.slice(0, 12)}`;
      console.log(`Collection name generated from metadata: ${collectionName}`);
      return collectionName;
    } catch (error) {
      console.error("Error getting collection name from EPUB:", error);
      throw error;
    }
  }

  // Process EPUB file and query ChromaDB collection
  async processAndQuery(
    epubKey: string,
    query: string
  ): Promise<QueryResponse> {
    try {
      // First download the file to get metadata
      const downloaded = await this.s3Service.downloadFile(
        epubKey,
        this.localFilePath
      );
      if (!downloaded) {
        return { error: "Failed to download EPUB file" };
      }

      // Read the file content
      const epubBuffer = await readFile(this.localFilePath);

      // Get collection name based on epub metadata
      const collectionName = await this.getCollectionNameFromEpub(epubBuffer);

      // First check if collection exists
      let collectionExists = false;
      try {
        // Try to get collection - this should throw if collection doesn't exist
        await this.chromaService.getOrCreateCollection(collectionName);
        collectionExists = true;
      } catch (error) {
        console.log("Collection does not exist, will process EPUB...");
      }

      if (!collectionExists) {
        // Process EPUB file and add to collection
        const processed = await this.processEpub(collectionName);
        if (!processed) {
          return { error: "Failed to process EPUB file" };
        }
        console.log("EPUB processed successfully");
      }

      // Query the collection (whether it existed or we just created it)
      const results = await this.chromaService.queryCollection(
        collectionName,
        query
      );

      if (!results.documents[0]?.length) {
        return { error: "No results found for query" };
      }

      const context = results.documents[0].join("\n\n");
      const answer = await this.openAIService.generateResponse(context, query);

      // Cleanup temporary file
      await unlink(this.localFilePath).catch((err) =>
        console.error("Error deleting temporary file:", err)
      );

      return {
        answer,
        source_documents: results.documents[0].filter(
          (doc): doc is string => doc !== null
        ),
      };
    } catch (error) {
      console.error("Error in processAndQuery:", error);
      if (error instanceof Error) {
        return {
          error: error.message || "An error occurred during processing",
        };
      }
      return { error: "An unknown error occurred during processing" };
    }
  }
}
