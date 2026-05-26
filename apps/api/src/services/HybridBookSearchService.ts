import MiniSearch from "minisearch";
import {
    vectorStore,
    type VectorSearchResult,
    type VectorStoreProvider,
} from "@reader/providers";
import {
    bookSearchChunkStore,
    type BookSearchChunk,
} from "./BookSearchChunkStore";

export interface BookSearchChunkReader {
    getCollectionChunks(collectionName: string): Promise<BookSearchChunk[]>;
}

export interface RankedSearchResult {
    id: string;
    content: string;
    chunkIndex: number;
    score: number;
    bestRank: number;
}

interface LexicalSearchResult {
    id: string;
    content: string;
    chunkIndex: number;
    rank: number;
}

interface CachedMiniSearchIndex {
    index: MiniSearch<BookSearchChunk>;
    chunksById: Map<string, BookSearchChunk>;
    createdAt: number;
}

const RRF_K = 60;
const INDEX_CACHE_TTL_MS = 60 * 60 * 1000;

const parseChunkIndex = (id: string) => {
    const maybeIndex = Number(id.slice(id.lastIndexOf("_") + 1));
    return Number.isFinite(maybeIndex) ? maybeIndex : Number.MAX_SAFE_INTEGER;
};

export class HybridBookSearchService {
    private readonly indexes = new Map<string, CachedMiniSearchIndex>();

    constructor(
        private readonly chunkStore: BookSearchChunkReader = bookSearchChunkStore,
        private readonly semanticSearch: Pick<
            VectorStoreProvider,
            "searchDocuments"
        > = vectorStore
    ) {}

    clearCollectionCache(collectionName: string) {
        this.indexes.delete(collectionName);
    }

    private async getMiniSearchIndex(collectionName: string) {
        const cached = this.indexes.get(collectionName);
        if (cached && Date.now() - cached.createdAt < INDEX_CACHE_TTL_MS) {
            return cached;
        }

        const chunks = await this.chunkStore.getCollectionChunks(collectionName);
        if (!chunks.length) return null;

        const index = new MiniSearch<BookSearchChunk>({
            fields: ["content"],
            storeFields: ["content", "chunkIndex"],
            idField: "id",
        });
        index.addAll(chunks);

        const next = {
            index,
            chunksById: new Map(chunks.map((chunk) => [chunk.id, chunk])),
            createdAt: Date.now(),
        };
        this.indexes.set(collectionName, next);
        return next;
    }

    private async searchLexical(
        collectionName: string,
        query: string,
        limit: number
    ): Promise<LexicalSearchResult[]> {
        if (!query.trim()) return [];

        const cached = await this.getMiniSearchIndex(collectionName);
        if (!cached) return [];

        return cached.index
            .search(query, {
                prefix: true,
            })
            .slice(0, limit)
            .map((result, index) => {
                const chunk = cached.chunksById.get(String(result.id));
                return {
                    id: String(result.id),
                    content: String(result.content ?? chunk?.content ?? ""),
                    chunkIndex: Number(result.chunkIndex ?? chunk?.chunkIndex),
                    rank: index + 1,
                };
            })
            .filter((result) => result.content);
    }

    private fuseResults(
        lexicalResults: LexicalSearchResult[],
        vectorResults: VectorSearchResult[],
        limit: number
    ): RankedSearchResult[] {
        const fused = new Map<string, RankedSearchResult>();

        const addResult = (
            result: {
                id: string;
                content: string;
                rank: number;
                chunkIndex?: number;
            },
            rank: number
        ) => {
            const existing = fused.get(result.id);
            const score = 1 / (RRF_K + rank);
            if (existing) {
                existing.score += score;
                existing.bestRank = Math.min(existing.bestRank, rank);
                if (!existing.content && result.content) {
                    existing.content = result.content;
                }
                return;
            }

            fused.set(result.id, {
                id: result.id,
                content: result.content,
                chunkIndex: result.chunkIndex ?? parseChunkIndex(result.id),
                score,
                bestRank: rank,
            });
        };

        lexicalResults.forEach((result) => addResult(result, result.rank));
        vectorResults.forEach((result) => addResult(result, result.rank));

        return Array.from(fused.values())
            .filter((result) => result.content)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
                return a.chunkIndex - b.chunkIndex;
            })
            .slice(0, limit);
    }

    async search(
        collectionName: string,
        query: string,
        options: {
            lexicalLimit?: number;
            vectorLimit?: number;
            finalLimit?: number;
        } = {}
    ): Promise<RankedSearchResult[]> {
        const lexicalLimit = options.lexicalLimit ?? 20;
        const vectorLimit = options.vectorLimit ?? 20;
        const finalLimit = options.finalLimit ?? 5;

        const [lexicalResults, vectorResults] = await Promise.all([
            this.searchLexical(collectionName, query, lexicalLimit),
            this.semanticSearch.searchDocuments(
                collectionName,
                query,
                vectorLimit
            ),
        ]);

        if (!lexicalResults.length) {
            return vectorResults.slice(0, finalLimit).map((result) => ({
                id: result.id,
                content: result.content,
                chunkIndex: parseChunkIndex(result.id),
                score: 1 / (RRF_K + result.rank),
                bestRank: result.rank,
            }));
        }

        return this.fuseResults(lexicalResults, vectorResults, finalLimit);
    }
}

export const hybridBookSearchService = new HybridBookSearchService();
