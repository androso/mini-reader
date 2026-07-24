import assert from "node:assert/strict";
import test from "node:test";
import {
    __resetSharedBookCoverLoadsForTests,
    fetchProtectedEpubCover,
    getSharedBookCoverLoadCountForTests,
    startLazyBookCoverLoad,
    type VisibilityObserverFactory,
} from "../src/components/bookCoverLoading";

const createVisibilityHarness = () => {
    let onEntries:
        | ((entries: ReadonlyArray<{ isIntersecting: boolean }>) => void)
        | undefined;
    const observed: object[] = [];
    const rootMargins: string[] = [];
    let disconnects = 0;
    const createObserver: VisibilityObserverFactory = (callback, options) => {
        onEntries = callback;
        rootMargins.push(options.rootMargin);
        return {
            disconnect: () => {
                disconnects++;
            },
            observe: (target) => observed.push(target),
        };
    };

    return {
        createObserver,
        emit: (isIntersecting: boolean) => onEntries?.([{ isIntersecting }]),
        observed,
        rootMargins,
        get disconnects() {
            return disconnects;
        },
    };
};

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

test.beforeEach(() => {
    __resetSharedBookCoverLoadsForTests();
});

test("offscreen EPUB covers wait for the 200px visibility boundary", () => {
    const visibility = createVisibilityHarness();
    const target = {};
    let loads = 0;
    const stop = startLazyBookCoverLoad({
        bookId: "book-a",
        fileType: "epub",
        target,
        createObserver: visibility.createObserver,
        createAbortController: () => new AbortController(),
        loadCover: async () => {
            loads++;
            return { status: "missing" };
        },
        createObjectUrl: () => "blob:unused",
        onCoverUrl: () => undefined,
        revokeObjectUrl: () => undefined,
    });

    assert.deepEqual(visibility.observed, [target]);
    assert.deepEqual(visibility.rootMargins, ["200px"]);
    assert.equal(loads, 0);

    visibility.emit(false);
    assert.equal(loads, 0);
    stop();
    assert.equal(visibility.disconnects, 1);
    visibility.emit(true);
    assert.equal(loads, 0);
});

test("an EPUB cover starts once and stops observing on first visibility", () => {
    const visibility = createVisibilityHarness();
    let loads = 0;
    const stop = startLazyBookCoverLoad({
        bookId: "book-b",
        fileType: "epub",
        target: {},
        createObserver: visibility.createObserver,
        createAbortController: () => new AbortController(),
        loadCover: async () => {
            loads++;
            return { status: "missing" };
        },
        createObjectUrl: () => "blob:unused",
        onCoverUrl: () => undefined,
        revokeObjectUrl: () => undefined,
    });

    visibility.emit(true);
    visibility.emit(true);
    assert.equal(loads, 1);
    assert.equal(visibility.disconnects, 1);

    stop();
    assert.equal(visibility.disconnects, 1);
});

test("missing IntersectionObserver safely loads an EPUB cover immediately", () => {
    let loads = 0;
    const stop = startLazyBookCoverLoad({
        bookId: "book-c",
        fileType: "epub",
        target: {},
        createAbortController: () => new AbortController(),
        loadCover: async () => {
            loads++;
            return { status: "missing" };
        },
        createObjectUrl: () => "blob:unused",
        onCoverUrl: () => undefined,
        revokeObjectUrl: () => undefined,
    });

    assert.equal(loads, 1);
    stop();
});

test("legacy titles ending in .epub load when fileType is missing", () => {
    let loads = 0;
    const stop = startLazyBookCoverLoad({
        bookId: "legacy-1",
        fileType: null,
        title: "Confessions.epub",
        target: {},
        createAbortController: () => new AbortController(),
        loadCover: async () => {
            loads++;
            return { status: "missing" };
        },
        createObjectUrl: () => "blob:unused",
        onCoverUrl: () => undefined,
        revokeObjectUrl: () => undefined,
    });

    assert.equal(loads, 1);
    stop();
});

test("protected cover fetches use only the book-ID URL and session cookie", async () => {
    const controller = new AbortController();
    const file = new Blob(["epub"]);
    const calls: Array<{
        options: { credentials: "include"; signal: AbortSignal };
        url: string;
    }> = [];
    let extracted: Blob | null = null;

    const result = await fetchProtectedEpubCover(
        "book-123",
        controller.signal,
        {
            buildApiUrl: (path) => `https://reader.test${path}`,
            fetch: async (url, options) => {
                calls.push({ url, options });
                return { ok: true, blob: async () => file };
            },
            extractCover: async (received) => {
                extracted = received;
                return {
                    status: "cover",
                    blob: new Blob(["cover"]),
                    mediaType: "image/jpeg",
                    path: "cover.jpg",
                };
            },
        }
    );

    assert.equal(result.status, "cover");
    assert.equal(extracted, file);
    assert.deepEqual(calls, [
        {
            url: "https://reader.test/api/books/book-123",
            options: {
                credentials: "include",
                signal: controller.signal,
            },
        },
    ]);
});

test("failed protected fetches do not unzip a response body", async () => {
    let extractions = 0;
    const result = await fetchProtectedEpubCover(
        "book-123",
        new AbortController().signal,
        {
            buildApiUrl: (path) => path,
            fetch: async () => ({
                ok: false,
                blob: async () => new Blob(),
            }),
            extractCover: async () => {
                extractions++;
                return {
                    status: "cover",
                    blob: new Blob(["x"]),
                    mediaType: "image/jpeg",
                    path: "x.jpg",
                };
            },
        }
    );

    assert.equal(result.status, "unauthorized");
    assert.equal(extractions, 0);
});

test("PDF cards remain placeholders without observers, fetches, or controllers", () => {
    let observers = 0;
    let controllers = 0;
    let loads = 0;
    const coverUrls: Array<string | null> = [];
    const stop = startLazyBookCoverLoad({
        bookId: "pdf-1",
        fileType: "pdf",
        target: {},
        createObserver: () => {
            observers++;
            throw new Error("PDF cards must not be observed");
        },
        createAbortController: () => {
            controllers++;
            return new AbortController();
        },
        loadCover: async () => {
            loads++;
            return { status: "cover", blob: new Blob(["x"]) };
        },
        createObjectUrl: () => "blob:unexpected",
        onCoverUrl: (url) => coverUrls.push(url),
        revokeObjectUrl: () => undefined,
    });

    assert.deepEqual(coverUrls, [null]);
    assert.equal(observers, 0);
    assert.equal(controllers, 0);
    assert.equal(loads, 0);
    stop();
});

test("duplicate visible covers share one fetch and one object URL", async () => {
    const visibilityA = createVisibilityHarness();
    const visibilityB = createVisibilityHarness();
    let loads = 0;
    let objectUrls = 0;
    const revoked: string[] = [];
    const urlsA: Array<string | null> = [];
    const urlsB: Array<string | null> = [];
    const blob = new Blob(["cover-bytes"]);

    const stopA = startLazyBookCoverLoad({
        bookId: "shared-1",
        fileType: "epub",
        target: {},
        createObserver: visibilityA.createObserver,
        createAbortController: () => new AbortController(),
        loadCover: async () => {
            loads++;
            return { status: "cover", blob };
        },
        createObjectUrl: () => {
            objectUrls++;
            return "blob:shared";
        },
        onCoverUrl: (url) => urlsA.push(url),
        revokeObjectUrl: (url) => revoked.push(url),
    });
    const stopB = startLazyBookCoverLoad({
        bookId: "shared-1",
        fileType: "epub",
        target: {},
        createObserver: visibilityB.createObserver,
        createAbortController: () => new AbortController(),
        loadCover: async () => {
            loads++;
            return { status: "cover", blob };
        },
        createObjectUrl: () => {
            objectUrls++;
            return "blob:shared-other";
        },
        onCoverUrl: (url) => urlsB.push(url),
        revokeObjectUrl: (url) => revoked.push(url),
    });

    visibilityA.emit(true);
    visibilityB.emit(true);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(loads, 1);
    assert.equal(objectUrls, 1);
    assert.deepEqual(urlsA, [null, "blob:shared"]);
    assert.deepEqual(urlsB, [null, "blob:shared"]);
    assert.equal(getSharedBookCoverLoadCountForTests(), 1);

    stopA();
    assert.deepEqual(revoked, []);
    stopB();
    assert.deepEqual(revoked, ["blob:shared"]);
    assert.equal(getSharedBookCoverLoadCountForTests(), 0);
});

test("cleanup disconnects, aborts, and revokes stale async completions", async () => {
    const visibility = createVisibilityHarness();
    const completion = deferred<{ status: "cover"; blob: Blob }>();
    const controller = new AbortController();
    const coverUrls: Array<string | null> = [];
    const revoked: string[] = [];
    const stop = startLazyBookCoverLoad({
        bookId: "stale-1",
        fileType: "epub",
        target: {},
        createObserver: visibility.createObserver,
        createAbortController: () => controller,
        loadCover: () => completion.promise,
        createObjectUrl: () => "blob:stale",
        onCoverUrl: (url) => coverUrls.push(url),
        revokeObjectUrl: (url) => revoked.push(url),
    });

    visibility.emit(true);
    stop();
    assert.equal(controller.signal.aborted, true);
    assert.equal(visibility.disconnects, 1);

    completion.resolve({ status: "cover", blob: new Blob(["x"]) });
    await completion.promise;
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(coverUrls, [null]);
    assert.deepEqual(revoked, []);
});

test("cleanup revokes an active URL exactly once", async () => {
    const visibility = createVisibilityHarness();
    const coverUrls: Array<string | null> = [];
    const revoked: string[] = [];
    const stop = startLazyBookCoverLoad({
        bookId: "active-1",
        fileType: "epub",
        target: {},
        createObserver: visibility.createObserver,
        createAbortController: () => new AbortController(),
        loadCover: async () => ({
            status: "cover",
            blob: new Blob(["active"]),
        }),
        createObjectUrl: () => "blob:active",
        onCoverUrl: (url) => coverUrls.push(url),
        revokeObjectUrl: (url) => revoked.push(url),
    });

    visibility.emit(true);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(coverUrls, [null, "blob:active"]);

    stop();
    stop();
    assert.deepEqual(revoked, ["blob:active"]);
});

test("local cover loading keeps abort and object-url cleanup guarantees", async () => {
    const offlineBlob = deferred<Blob>();
    const controller = new AbortController();
    let networkFetches = 0;
    let objectUrls = 0;
    const stop = startLazyBookCoverLoad({
        bookId: "offline-cover",
        fileType: "epub",
        target: {},
        createAbortController: () => controller,
        loadCover: (signal) =>
            fetchProtectedEpubCover("offline-cover", signal, {
                buildApiUrl: (path) => path,
                getOfflineBookBlob: () => offlineBlob.promise,
                extractCover: async () => new Blob(["cover"]),
                fetch: async () => {
                    networkFetches += 1;
                    return {
                        ok: true,
                        blob: async () => new Blob(["network"]),
                    };
                },
            }),
        createObjectUrl: () => {
            objectUrls += 1;
            return "blob:offline-cover";
        },
        onCoverUrl: () => undefined,
        revokeObjectUrl: () => undefined,
    });

    stop();
    offlineBlob.resolve(new Blob(["epub"]));
    await offlineBlob.promise;
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(controller.signal.aborted, true);
    assert.equal(networkFetches, 0);
    assert.equal(objectUrls, 0);
});
