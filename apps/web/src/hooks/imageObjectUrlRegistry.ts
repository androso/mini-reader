export type RevokeObjectUrl = (url: string) => void;

export class ImageObjectUrlRegistry {
    private generation = 0;
    private readonly urls = new Set<string>();

    constructor(private readonly revokeObjectUrl: RevokeObjectUrl) {}

    startArchive(): number {
        this.generation += 1;
        this.revokeAll();
        return this.generation;
    }

    register(generation: number, url: string): boolean {
        if (generation !== this.generation) {
            this.revokeObjectUrl(url);
            return false;
        }

        this.urls.add(url);
        return true;
    }

    isCurrent(generation: number): boolean {
        return generation === this.generation;
    }

    dispose(generation: number): void {
        if (!this.isCurrent(generation)) return;

        this.generation += 1;
        this.revokeAll();
    }

    private revokeAll(): void {
        for (const url of this.urls) this.revokeObjectUrl(url);
        this.urls.clear();
    }
}
