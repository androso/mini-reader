export type RevokeObjectUrl = (url: string) => void;

/**
 * Tracks blob object URLs by archive generation and chapter scope.
 * Stale async completions for a retired generation or chapter are revoked
 * immediately instead of joining the active set.
 */
export class ImageObjectUrlRegistry {
    private generation = 0;
    private readonly urlsByChapter = new Map<string, Set<string>>();
    private readonly urlChapter = new Map<string, string>();

    constructor(private readonly revokeObjectUrl: RevokeObjectUrl) {}

    startArchive(): number {
        this.generation += 1;
        this.revokeAll();
        return this.generation;
    }

    register(generation: number, chapterId: string, url: string): boolean {
        if (generation !== this.generation || !chapterId) {
            this.revokeObjectUrl(url);
            return false;
        }

        let chapterUrls = this.urlsByChapter.get(chapterId);
        if (!chapterUrls) {
            chapterUrls = new Set();
            this.urlsByChapter.set(chapterId, chapterUrls);
        }
        chapterUrls.add(url);
        this.urlChapter.set(url, chapterId);
        return true;
    }

    isCurrent(generation: number): boolean {
        return generation === this.generation;
    }

    /**
     * Release every chapter except the ones listed (used after a commit).
     */
    retainChapters(chapterIds: Iterable<string>): void {
        const retain = new Set(chapterIds);
        for (const chapterId of Array.from(this.urlsByChapter.keys())) {
            if (!retain.has(chapterId)) {
                this.releaseChapter(chapterId);
            }
        }
    }

    releaseChapter(chapterId: string): void {
        const urls = this.urlsByChapter.get(chapterId);
        if (!urls) return;

        for (const url of urls) {
            this.revokeObjectUrl(url);
            this.urlChapter.delete(url);
        }
        this.urlsByChapter.delete(chapterId);
    }

    dispose(generation: number): void {
        if (!this.isCurrent(generation)) return;

        this.generation += 1;
        this.revokeAll();
    }

    private revokeAll(): void {
        for (const urls of this.urlsByChapter.values()) {
            for (const url of urls) this.revokeObjectUrl(url);
        }
        this.urlsByChapter.clear();
        this.urlChapter.clear();
    }
}
