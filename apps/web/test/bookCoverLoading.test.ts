import assert from "node:assert/strict";
import test from "node:test";
import {
    fetchProtectedEpubCover,
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

test("offscreen EPUB covers wait for the 200px visibility boundary", () => {
    const visibility = createVisibilityHarness();
    const target = {};
    let loads = 0;
    const stop = startLazyBookCoverLoad({
        fileType: "epub",
        target,
        createObserver: visibility.createObserver,
        createAbortController: () => new AbortController(),
        loadCover: async () => {
            loads++;
            return null;
        },
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
        fileType: "epub",
        target: {},
        createObserver: visibility.createObserver,
        createAbortController: () => new AbortController(),
        loadCover: async () => {
            loads++;
            return null;
        },
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
        fileType: "epub",
        target: {},
        createAbortController: () => new AbortController(),
        loadCover: async () => {
            loads++;
            return null;
        },
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
            extractCoverUrl: async (received) => {
                extracted = received;
                return "blob:cover";
            },
        }
    );

    assert.equal(result, "blob:cover");
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
            extractCoverUrl: async () => {
                extractions++;
                return "blob:unexpected";
            },
        }
    );

    assert.equal(result, null);
    assert.equal(extractions, 0);
});

test("PDF cards remain placeholders without observers, fetches, or controllers", () => {
    let observers = 0;
    let controllers = 0;
    let loads = 0;
    const coverUrls: Array<string | null> = [];
    const stop = startLazyBookCoverLoad({
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
            return "blob:unexpected";
        },
        onCoverUrl: (url) => coverUrls.push(url),
        revokeObjectUrl: () => undefined,
    });

    assert.deepEqual(coverUrls, [null]);
    assert.equal(observers, 0);
    assert.equal(controllers, 0);
    assert.equal(loads, 0);
    stop();
});

test("cleanup disconnects, aborts, and revokes stale async completions", async () => {
    const visibility = createVisibilityHarness();
    const completion = deferred<string | null>();
    const controller = new AbortController();
    const coverUrls: Array<string | null> = [];
    const revoked: string[] = [];
    const stop = startLazyBookCoverLoad({
        fileType: "epub",
        target: {},
        createObserver: visibility.createObserver,
        createAbortController: () => controller,
        loadCover: () => completion.promise,
        onCoverUrl: (url) => coverUrls.push(url),
        revokeObjectUrl: (url) => revoked.push(url),
    });

    visibility.emit(true);
    stop();
    assert.equal(controller.signal.aborted, true);
    assert.equal(visibility.disconnects, 1);

    completion.resolve("blob:stale");
    await completion.promise;
    await Promise.resolve();
    assert.deepEqual(coverUrls, [null]);
    assert.deepEqual(revoked, ["blob:stale"]);
});

test("cleanup revokes an active URL exactly once", async () => {
    const visibility = createVisibilityHarness();
    const coverUrls: Array<string | null> = [];
    const revoked: string[] = [];
    const stop = startLazyBookCoverLoad({
        fileType: "epub",
        target: {},
        createObserver: visibility.createObserver,
        createAbortController: () => new AbortController(),
        loadCover: async () => "blob:active",
        onCoverUrl: (url) => coverUrls.push(url),
        revokeObjectUrl: (url) => revoked.push(url),
    });

    visibility.emit(true);
    await Promise.resolve();
    assert.deepEqual(coverUrls, [null, "blob:active"]);

    stop();
    stop();
    assert.deepEqual(revoked, ["blob:active"]);
});
