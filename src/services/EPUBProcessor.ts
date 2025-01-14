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
import fs from "fs/promises";

export class EPUBProcessor {
  private chromaService: ChromaService;
  private openAIService: OpenAIService;

  constructor(bucketName: string) {
    // Initialize services
    this.chromaService = new ChromaService();
    this.openAIService = new OpenAIService();
  }

  private async extractTextFromEpub(buffer: Buffer): Promise<string[]> {
    console.log("[extractTextFromEpub] Starting EPUB text extraction");

    // Create temporary file
    const tempPath = path.join(__dirname, `temp_${Date.now()}.epub`);
    await fs.writeFile(tempPath, buffer);

    return new Promise((resolve, reject) => {
      const epub = new EPub(tempPath); // Use filepath instead of buffer
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
                    return;
                  }

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
              );
            });

            if (chapter.trim()) {
              try {
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
          await fs.unlink(tempPath);
        } catch (error) {
          console.error("[extractTextFromEpub] Fatal error:", error);
          reject(error);
          await fs.unlink(tempPath);
        }
      });
      epub.on("error", async (error) => {
        await fs.unlink(tempPath).catch(console.error);
        reject(error);
      });

      epub.parse();
      console.log("[extractTextFromEpub] Started EPUB parsing");
    });
  }

  // Process EPUB file and add to ChromaDB collection
  private async processEpub(
    collectionName: string,
    file: Buffer
  ): Promise<boolean> {
    console.log("[processEpub] Starting EPUB processing");
    try {
      console.log("[processEpub] Extracting text from EPUB");
      const chunks = await this.extractTextFromEpub(file);
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

  async getCollectionNameFromEpub(fileBuffer: Buffer): Promise<string> {
    try {
      const metadata = await extractMetadata(fileBuffer);
      const collectionHash = createHash(metadata);
      const collectionName = `book_${collectionHash.slice(0, 12)}`;
      console.log(`Collection name generated from metadata: ${collectionName}`);
      return collectionName;
    } catch (error) {
      console.error("Error getting collection name from EPUB:", error);
      throw error;
    }
  }

  async processBook(
    fileBuffer: Buffer
  ): Promise<{ collectionName: string; error?: string }> {
    try {
      const collectionName = await this.getCollectionNameFromEpub(fileBuffer);

      // Check if collection exists
      let collection = await this.chromaService.getCollection(collectionName);

      if (!collection) {
        // Collection doesn't exist, create and process it
        try {
          collection = await this.chromaService.createCollection(
            collectionName
          );
          const processed = await this.processEpub(collectionName, fileBuffer);
          if (!processed) {
            return { collectionName: "", error: "Error processing EPUB" };
          }
        } catch (err) {
          console.error("Error creating/processing collection:", err);
          return { collectionName: "", error: "Error creating collection" };
        }
      }

      return { collectionName };
    } catch (err) {
      console.error("Error processing book:", err);
      return { collectionName: "", error: "Error processing book" };
    }
  }
  //query ChromaDB collection
  async queryCollection(
    collectionName: string,
    query: string
  ): Promise<QueryResponse> {
    try {
      try {
        await this.chromaService.getOrCreateCollection(collectionName);
      } catch (err) {
        console.error("Error getting collection:", err);
        return { error: "Error getting collection" };
      }
      const results = await this.chromaService.queryCollection(
        collectionName,
        query
      );
      if (!results.documents[0]?.length) {
        return { error: "No results found for query" };
      }
      const context = results.documents[0].join("\n\n");
      const answer = await this.openAIService.generateResponse(context, query);

      return {
        answer,
        source_documents: results.documents[0].filter(
          (doc): doc is string => doc !== null
        ),
      };
    } catch (err) {
      console.error("Error querying collection:", err);
      return { error: "Error querying collection" };
    }
  }
}