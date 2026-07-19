export interface TextChunkerOptions {
    minChunkSize?: number;
    targetChunkSize?: number;
    maxChunkSize?: number;
}

export class TextChunker {
    private readonly minChunkSize: number;
    private readonly targetChunkSize: number;
    private readonly maxChunkSize: number;

    constructor(options: TextChunkerOptions = {}) {
        this.minChunkSize = options.minChunkSize ?? 100;
        this.targetChunkSize = options.targetChunkSize ?? 1000;
        this.maxChunkSize = options.maxChunkSize ?? 3800;
    }

    chunkText(text: string): string[] {
        const normalized = text.replace(/\s+/g, " ").trim();
        if (!normalized) return [];
        if (normalized.length <= this.maxChunkSize) return [normalized];

        const sentences = normalized.match(/.*?[.!?]+(?:\s+|$)|.+$/g) || [
            normalized,
        ];
        const chunks: string[] = [];
        let current = "";

        for (const sentence of sentences) {
            const candidate = `${current} ${sentence}`.trim();
            if (candidate.length <= this.targetChunkSize || !current) {
                current = candidate;
                continue;
            }

            chunks.push(...this.splitOversized(current));
            current = sentence.trim();
        }

        if (current) {
            chunks.push(...this.splitOversized(current));
        }

        return this.finalizeChunks(chunks);
    }

    private finalizeChunks(chunks: string[]): string[] {
        const nonEmpty = chunks.map((chunk) => chunk.trim()).filter(Boolean);
        if (nonEmpty.length <= 1) return nonEmpty;

        const tailIndex = nonEmpty.length - 1;
        const tail = nonEmpty[tailIndex];
        if (
            tail.length >= this.minChunkSize ||
            this.minChunkSize > this.maxChunkSize
        ) {
            return nonEmpty;
        }

        const previous = nonEmpty[tailIndex - 1];
        const combined = `${previous} ${tail}`.trim();
        if (combined.length <= this.maxChunkSize) {
            return [...nonEmpty.slice(0, -2), combined];
        }

        const minimumSuffixLength = Math.max(
            1,
            Math.min(this.minChunkSize, this.maxChunkSize)
        );
        const minimumSplitIndex = Math.max(
            1,
            combined.length - this.maxChunkSize
        );
        const maximumSplitIndex = Math.min(
            this.maxChunkSize,
            combined.length - 1
        );
        if (minimumSplitIndex > maximumSplitIndex) return nonEmpty;

        const idealSplitIndex = Math.min(
            Math.max(combined.length - minimumSuffixLength, minimumSplitIndex),
            maximumSplitIndex
        );
        let splitIndex = idealSplitIndex;
        for (
            let candidate = idealSplitIndex;
            candidate >= minimumSplitIndex;
            candidate--
        ) {
            if (/\s/.test(combined[candidate])) {
                splitIndex = candidate;
                break;
            }
        }

        const rebalancedPrevious = combined.slice(0, splitIndex).trimEnd();
        const rebalancedTail = combined.slice(splitIndex).trimStart();
        if (
            !rebalancedPrevious ||
            !rebalancedTail ||
            rebalancedPrevious.length > this.maxChunkSize ||
            rebalancedTail.length > this.maxChunkSize
        ) {
            return nonEmpty;
        }

        return [...nonEmpty.slice(0, -2), rebalancedPrevious, rebalancedTail];
    }

    private splitOversized(text: string): string[] {
        if (text.length <= this.maxChunkSize) return [text];

        const chunks = [];
        for (let i = 0; i < text.length; i += this.maxChunkSize) {
            chunks.push(text.slice(i, i + this.maxChunkSize).trim());
        }
        return chunks.filter(Boolean);
    }
}
