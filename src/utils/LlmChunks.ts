import { OpenAIService } from "../services/OpenAIServices";
import { Worker } from 'worker_threads';
import path from "path";

export class LLMChunker {
  private openAIService: OpenAIService;
  private defaultChunkSize = 1000;
  private minChunkSize = 100;  // Fixed typo in variable name
  private maxChunkSize = 8000; // Added max size limit
  private maxWorkers = 8;

  constructor() {
    this.openAIService = new OpenAIService();
  }
  private createWorker(chunks: string[]): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        path.resolve(__dirname, 'workers.ts'),
        {
          workerData: { chunks }
        }
      );

      worker.on('message', (result) => {
        if (result.success) {
          resolve(result.splits);
        } else {
          reject(new Error(result.error));
        }
      });

      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  private async processChunkBatch(chunks: string[][]): Promise<number[][]> {
    const workerPromises = chunks.map(chunk => this.createWorker(chunk));
    return Promise.all(workerPromises);
  }

  private createInitialChunks(text: string): string[] {
    if (!text || text.length < this.minChunkSize) {
      return text ? [text] : [];
    }

    const chunks: string[] = [];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = '';

    for (const sentence of sentences) {
      const potentialChunk = currentChunk + sentence;
      
      if (potentialChunk.length <= this.defaultChunkSize) {
        currentChunk = potentialChunk;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks.filter(chunk => 
      chunk.length >= this.minChunkSize && 
      chunk.length <= this.maxChunkSize
    );
  }

  async chunkText(text: string): Promise<string[]> {
    console.log('[LLMChunker] Starting text chunking');
    console.log(`[LLMChunker] Input text length: ${text.length}`);
    
    try {
      if (!text || text.length < this.minChunkSize) {
        console.log('[LLMChunker] Text too short, returning as single chunk');
        return text ? [text] : [];
      }

      console.log('[LLMChunker] Creating initial chunks');
      const initialChunks = this.createInitialChunks(text);
      console.log(`[LLMChunker] Created ${initialChunks.length} initial chunks`);
      
      if (initialChunks.length <= 1) {
        console.log('[LLMChunker] Single chunk, no further processing needed');
        return initialChunks;
      }

      const finalChunks: string[] = [];
      const batchSize = 5; // Process 5 chunks at a time
      
      // Process chunks in parallel batches
      for (let i = 0; i < initialChunks.length; i += batchSize * this.maxWorkers) {
        const batchChunks: string[][] = [];
        
        // Create batches for parallel processing
        for (let j = 0; j < this.maxWorkers && (i + j * batchSize) < initialChunks.length; j++) {
          const startIdx = i + j * batchSize;
          const endIdx = Math.min(startIdx + batchSize, initialChunks.length);
          const windowChunks = initialChunks.slice(startIdx, endIdx);
          batchChunks.push(windowChunks);
        }

        console.log(`[LLMChunker] Processing batch of ${batchChunks.length} windows`);
        const batchResults = await this.processChunkBatch(batchChunks);

        // Process results from each worker
        batchResults.forEach((splits, batchIndex) => {
          const chunksToProcess = batchChunks[batchIndex];
          
          if (!splits.length) {
            const combinedChunk = chunksToProcess.join(' ');
            if (combinedChunk.length <= this.maxChunkSize) {
              finalChunks.push(combinedChunk);
            } else {
              finalChunks.push(...chunksToProcess);
            }
          } else {
            let lastSplit = 0;
            for (const splitPoint of splits) {
              const chunkText = chunksToProcess
                .slice(lastSplit, splitPoint)
                .join(' ')
                .trim();
                
              if (chunkText && 
                  chunkText.length >= this.minChunkSize && 
                  chunkText.length <= this.maxChunkSize) {
                finalChunks.push(chunkText);
              }
              lastSplit = splitPoint;
            }
          }
        });
      }

      console.log(`[LLMChunker] Chunking complete. Final chunks: ${finalChunks.length}`);
      return finalChunks;

    } catch (error) {
      console.error('[LLMChunker] Error:', error);
      console.log('[LLMChunker] Falling back to basic chunking');
      return this.createInitialChunks(text);
    }
  }
}
