export interface TextChunkerOptions {
    minChunkSize?: number;
    targetChunkSize?: number;
    maxChunkSize?: number;
}

const requirePositiveSafeInteger = (name: string, value: number) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive safe integer`);
    }
};

export class TextChunker {
    private readonly minChunkSize: number;
    private readonly targetChunkSize: number;
    private readonly maxChunkSize: number;

    constructor(options: TextChunkerOptions = {}) {
        const minChunkSize = options.minChunkSize ?? 100;
        const targetChunkSize = options.targetChunkSize ?? 1000;
        const maxChunkSize = options.maxChunkSize ?? 3800;
        requirePositiveSafeInteger("minChunkSize", minChunkSize);
        requirePositiveSafeInteger("targetChunkSize", targetChunkSize);
        requirePositiveSafeInteger("maxChunkSize", maxChunkSize);
        this.minChunkSize = minChunkSize;
        this.targetChunkSize = targetChunkSize;
        this.maxChunkSize = maxChunkSize;
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
        let currentSeparatorBefore = "";

        for (const sentence of sentences) {
            const sentenceText = sentence.trim();
            if (!sentenceText) continue;
            const candidate = current
                ? `${current} ${sentenceText}`
                : sentenceText;
            if (candidate.length <= this.targetChunkSize || !current) {
                current = candidate;
                continue;
            }

            chunks.push(
                ...this.splitOversized(current, currentSeparatorBefore)
            );
            current = sentenceText;
            currentSeparatorBefore = chunks.length ? " " : "";
        }

        if (current) {
            chunks.push(
                ...this.splitOversized(current, currentSeparatorBefore)
            );
        }

        return this.finalizeChunks(chunks);
    }

    private finalizeChunks(chunks: string[]): string[] {
        const nonEmpty = chunks.filter((chunk) => chunk.length > 0);
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
        const combined = `${previous}${tail}`;
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

        const rebalancedPrevious = combined.slice(0, splitIndex);
        const rebalancedTail = combined.slice(splitIndex);
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

    private splitOversized(text: string, separatorBefore: string): string[] {
        const source = `${separatorBefore}${text}`;
        if (source.length <= this.maxChunkSize) return [source];

        const chunks: string[] = [];
        for (let i = 0; i < source.length; i += this.maxChunkSize) {
            chunks.push(source.slice(i, i + this.maxChunkSize));
        }
        return chunks;
    }
}
