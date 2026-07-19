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

export interface ProtectedCoverDependencies {
    buildApiUrl(path: string): string;
    extractCoverUrl(file: Blob): Promise<string | null>;
    fetch(
        url: string,
        options: { credentials: "include"; signal: AbortSignal }
    ): Promise<CoverResponse>;
}

export const fetchProtectedEpubCover = async (
    bookId: string,
    signal: AbortSignal,
    dependencies: ProtectedCoverDependencies
): Promise<string | null> => {
    const response = await dependencies.fetch(
        dependencies.buildApiUrl(`/api/books/${bookId}`),
        { credentials: "include", signal }
    );
    if (!response.ok) return null;

    return dependencies.extractCoverUrl(await response.blob());
};

export interface LazyBookCoverOptions {
    fileType?: "epub" | "pdf" | null;
    target: object;
    createObserver?: VisibilityObserverFactory;
    createAbortController(): AbortController;
    loadCover(signal: AbortSignal): Promise<string | null>;
    onCoverUrl(url: string | null): void;
    onError?(error: unknown): void;
    revokeObjectUrl(url: string): void;
}

export const startLazyBookCoverLoad = (
    options: LazyBookCoverOptions
): (() => void) => {
    options.onCoverUrl(null);
    if (options.fileType !== "epub") return () => undefined;

    let activeObjectUrl: string | null = null;
    let abortController: AbortController | null = null;
    let disposed = false;
    let started = false;

    const start = () => {
        if (disposed || started) return;
        started = true;
        abortController = options.createAbortController();

        let loading: Promise<string | null>;
        try {
            loading = options.loadCover(abortController.signal);
        } catch (error) {
            if (!disposed && !abortController.signal.aborted) {
                options.onError?.(error);
            }
            return;
        }

        void loading.then(
            (objectUrl) => {
                if (!objectUrl) return;
                if (disposed) {
                    options.revokeObjectUrl(objectUrl);
                    return;
                }

                activeObjectUrl = objectUrl;
                options.onCoverUrl(objectUrl);
            },
            (error) => {
                if (!disposed && !abortController?.signal.aborted) {
                    options.onError?.(error);
                }
            }
        );
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
        abortController?.abort();
        if (activeObjectUrl) {
            options.revokeObjectUrl(activeObjectUrl);
            activeObjectUrl = null;
        }
    };
};
