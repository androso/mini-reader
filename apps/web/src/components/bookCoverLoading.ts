import type { EpubCoverExtractionResult } from "../lib/epubCoverExtraction";
import { isEpubBook, type BookFileKindInput } from "../lib/bookFileKind";

export interface VisibilityObserver {
    observe(target: object): void;
    disconnect(): void;
}

export type VisibilityObserverFactory = (
    onEntries: (entries: ReadonlyArray<{ isIntersecting: boolean }>) => void,
    options: { rootMargin: string }
) => VisibilityObserver;

export const observeOnceVisible = (
    target: object,
    onVisible: () => void,
    createObserver?: VisibilityObserverFactory
): (() => void) => {
    if (!createObserver) {
        onVisible();
        return () => undefined;
    }

    let active = true;
    let revealed = false;
    let disconnectWhenReady = false;
    let observer: VisibilityObserver | null = null;
    const reveal = () => {
        if (!active || revealed) return;

        revealed = true;
        active = false;
        if (observer) observer.disconnect();
        else disconnectWhenReady = true;
        onVisible();
    };

    observer = createObserver(
        (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) reveal();
        },
        { rootMargin: "200px" }
    );

    if (disconnectWhenReady) observer.disconnect();
    else observer.observe(target);

    return () => {
        if (!active) return;
        active = false;
        observer?.disconnect();
    };
};

interface CoverResponse {
    ok: boolean;
    blob(): Promise<Blob>;
}

export type ProtectedCoverLoadResult =
    | { status: "cover"; blob: Blob }
    | { status: "missing" }
    | { status: "invalid" }
    | { status: "unauthorized" };

export interface ProtectedCoverDependencies {
    buildApiUrl(path: string): string;
    extractCover(file: Blob): Promise<EpubCoverExtractionResult | Blob | null>;
    getOfflineBookBlob?(bookId: string): Promise<Blob | undefined>;
    fetch(
        url: string,
        options: { credentials: "include"; signal: AbortSignal }
    ): Promise<CoverResponse>;
}

const toProtectedCoverResult = async (
    extracted: EpubCoverExtractionResult | Blob | null
): Promise<ProtectedCoverLoadResult> => {
    if (!extracted) return { status: "missing" };
    if (extracted instanceof Blob) {
        return extracted.size > 0
            ? { status: "cover", blob: extracted }
            : { status: "missing" };
    }
    if (extracted.status === "cover") {
        return { status: "cover", blob: extracted.blob };
    }
    return { status: extracted.status };
};

export const fetchProtectedEpubCover = async (
    bookId: string,
    signal: AbortSignal,
    dependencies: ProtectedCoverDependencies
): Promise<ProtectedCoverLoadResult> => {
    const offlineBlob = await dependencies.getOfflineBookBlob?.(bookId);
    if (offlineBlob) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        return toProtectedCoverResult(
            await dependencies.extractCover(offlineBlob)
        );
    }

    const response = await dependencies.fetch(
        dependencies.buildApiUrl(`/api/books/${bookId}`),
        { credentials: "include", signal }
    );
    if (!response.ok) return { status: "unauthorized" };

    return toProtectedCoverResult(
        await dependencies.extractCover(await response.blob())
    );
};

interface SharedCoverEntry {
    bookId: string;
    promise: Promise<string | null>;
    abortController: AbortController;
    objectUrl: string | null;
    refs: number;
    settled: boolean;
}

const sharedCoverLoads = new Map<string, SharedCoverEntry>();

export const __resetSharedBookCoverLoadsForTests = () => {
    sharedCoverLoads.clear();
};

export const getSharedBookCoverLoadCountForTests = () => sharedCoverLoads.size;

const releaseSharedCover = (
    bookId: string,
    revokeObjectUrl: (url: string) => void
) => {
    const entry = sharedCoverLoads.get(bookId);
    if (!entry) return;

    entry.refs -= 1;
    if (entry.refs > 0) return;

    sharedCoverLoads.delete(bookId);
    if (!entry.settled) {
        entry.abortController.abort();
    }
    if (entry.objectUrl) {
        revokeObjectUrl(entry.objectUrl);
        entry.objectUrl = null;
    }
};

const acquireSharedCover = (
    bookId: string,
    options: {
        createAbortController(): AbortController;
        loadCover(signal: AbortSignal): Promise<ProtectedCoverLoadResult>;
        createObjectUrl(blob: Blob): string;
        revokeObjectUrl(url: string): void;
        onError?(error: unknown): void;
    }
): { promise: Promise<string | null>; release(): void } => {
    let entry = sharedCoverLoads.get(bookId);
    if (!entry) {
        const abortController = options.createAbortController();
        const created: SharedCoverEntry = {
            bookId,
            abortController,
            objectUrl: null,
            refs: 0,
            settled: false,
            promise: Promise.resolve(null),
        };

        let loading: Promise<ProtectedCoverLoadResult>;
        try {
            loading = options.loadCover(abortController.signal);
        } catch (error) {
            created.settled = true;
            created.promise = Promise.resolve(null);
            if (!abortController.signal.aborted) {
                options.onError?.(error);
            }
            entry = created;
            sharedCoverLoads.set(bookId, created);
            entry.refs += 1;
            return {
                promise: created.promise,
                release: () =>
                    releaseSharedCover(bookId, options.revokeObjectUrl),
            };
        }

        created.promise = loading.then(
            (result) => {
                created.settled = true;
                if (result.status !== "cover" || created.refs <= 0) {
                    if (created.refs <= 0) {
                        sharedCoverLoads.delete(bookId);
                    }
                    return null;
                }

                const objectUrl = options.createObjectUrl(result.blob);
                created.objectUrl = objectUrl;
                return objectUrl;
            },
            (error) => {
                created.settled = true;
                if (created.refs <= 0) {
                    sharedCoverLoads.delete(bookId);
                }
                if (!abortController.signal.aborted) {
                    options.onError?.(error);
                }
                return null;
            }
        );

        entry = created;
        sharedCoverLoads.set(bookId, entry);
    }

    entry.refs += 1;

    return {
        promise: entry.promise,
        release: () => releaseSharedCover(bookId, options.revokeObjectUrl),
    };
};

export interface LazyBookCoverOptions {
    bookId: string;
    fileType?: BookFileKindInput["fileType"];
    title?: string | null;
    target: object;
    createObserver?: VisibilityObserverFactory;
    createAbortController(): AbortController;
    loadCover(signal: AbortSignal): Promise<ProtectedCoverLoadResult>;
    createObjectUrl(blob: Blob): string;
    onCoverUrl(url: string | null): void;
    onError?(error: unknown): void;
    revokeObjectUrl(url: string): void;
}

export const startLazyBookCoverLoad = (
    options: LazyBookCoverOptions
): (() => void) => {
    options.onCoverUrl(null);
    if (!isEpubBook({ fileType: options.fileType, title: options.title })) {
        return () => undefined;
    }

    let disposed = false;
    let started = false;
    let releaseShared: (() => void) | null = null;

    const start = () => {
        if (disposed || started) return;
        started = true;

        const shared = acquireSharedCover(options.bookId, {
            createAbortController: options.createAbortController,
            loadCover: options.loadCover,
            createObjectUrl: options.createObjectUrl,
            revokeObjectUrl: options.revokeObjectUrl,
            onError: options.onError,
        });
        releaseShared = shared.release;

        void shared.promise.then((objectUrl) => {
            if (disposed) return;
            options.onCoverUrl(objectUrl);
        });
    };

    const stopObserving = observeOnceVisible(
        options.target,
        start,
        options.createObserver
    );

    return () => {
        if (disposed) return;
        disposed = true;
        stopObserving();
        releaseShared?.();
        releaseShared = null;
    };
};
