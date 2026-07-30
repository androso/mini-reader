import assert from "node:assert/strict";
import test from "node:test";
import {
    enqueueReaderPackage,
    generateAndPersistReaderPackage,
    getOwnedReaderChapter,
    getOwnedReaderManifest,
    getOwnedReaderResource,
    processNextReaderPackageJob,
    type OwnedReaderBook,
    type ReaderPackageDependencies,
    type ReaderPackageRepository,
} from "../src/services/ReaderPackageService";

const bookId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

const ownedBook = (
    overrides: Partial<OwnedReaderBook> = {}
): OwnedReaderBook => ({
    id: bookId,
    title: "Owned EPUB",
    creator: "Author",
    fileType: "epub",
    readerPackageStatus: "not_requested",
    readerPackageError: null,
    readerPackageGeneratedAt: null,
    readerPackageToc: null,
    ...overrides,
});

const createHarness = ({
    book = ownedBook(),
    chapters = [],
    resources = [],
    chapter = null,
    resource = null,
    fileBytes = Buffer.from("image-bytes"),
}: {
    book?: OwnedReaderBook | null;
    chapters?: Array<{
        id: string;
        title: string | null;
        href: string;
        chapterOrder: number;
        blocks: Array<{ id: string; html: string; text: string }>;
    }>;
    resources?: Array<{
        id: string;
        mediaType: string;
        size: number;
        isCover: boolean;
    }>;
    chapter?: {
        id: string;
        title: string | null;
        href: string;
        order: number;
        blocks: Array<{ id: string; html: string; text: string }>;
    } | null;
    resource?: { storageKey: string; mediaType: string } | null;
    fileBytes?: Buffer;
} = {}) => {
    const calls = {
        finds: [] as Array<{ bookId: string; userId: string }>,
        enqueueFinds: [] as Array<{ bookId: string; userId: string }>,
        enqueues: [] as Array<{
            bookId: string;
            userId: string;
            resetFailed: boolean;
        }>,
        marks: [] as Array<{ bookId: string; userId: string }>,
        chapters: [] as string[],
        resources: [] as string[],
        chapterLooks: [] as Array<{
            bookId: string;
            chapterId: string;
            userId: string;
        }>,
        resourceLooks: [] as Array<{
            bookId: string;
            resourceId: string;
            userId: string;
        }>,
        files: [] as string[],
    };

    const repository: ReaderPackageRepository = {
        async findOwnedBook(requestedBookId, requestedUserId) {
            calls.finds.push({
                bookId: requestedBookId,
                userId: requestedUserId,
            });
            return book;
        },
        async findOwnedBookForEnqueue(requestedBookId, requestedUserId) {
            calls.enqueueFinds.push({
                bookId: requestedBookId,
                userId: requestedUserId,
            });
            return book ? { id: book.id, fileType: book.fileType } : null;
        },
        async enqueueJob(requestedBookId, requestedUserId, resetFailed) {
            calls.enqueues.push({
                bookId: requestedBookId,
                userId: requestedUserId,
                resetFailed,
            });
        },
        async markBookProcessing(requestedBookId, requestedUserId) {
            calls.marks.push({
                bookId: requestedBookId,
                userId: requestedUserId,
            });
        },
        async listChapters(requestedBookId) {
            calls.chapters.push(requestedBookId);
            return chapters;
        },
        async listResources(requestedBookId) {
            calls.resources.push(requestedBookId);
            return resources;
        },
        async findOwnedChapter(
            requestedBookId,
            requestedChapterId,
            requestedUserId
        ) {
            calls.chapterLooks.push({
                bookId: requestedBookId,
                chapterId: requestedChapterId,
                userId: requestedUserId,
            });
            return chapter;
        },
        async findOwnedResource(
            requestedBookId,
            requestedResourceId,
            requestedUserId
        ) {
            calls.resourceLooks.push({
                bookId: requestedBookId,
                resourceId: requestedResourceId,
                userId: requestedUserId,
            });
            return resource;
        },
    };

    const dependencies: ReaderPackageDependencies = {
        repository,
        getFile: async (key) => {
            calls.files.push(key);
            return fileBytes;
        },
    };

    return { calls, dependencies };
};

test("getOwnedReaderManifest returns not_found for missing books", async () => {
    const { calls, dependencies } = createHarness({ book: null });

    assert.deepEqual(
        await getOwnedReaderManifest(bookId, userId, dependencies),
        {
            kind: "not_found",
        }
    );
    assert.deepEqual(calls.finds, [{ bookId, userId }]);
    assert.deepEqual(calls.enqueues, []);
});

test("getOwnedReaderManifest returns unsupported for non-EPUB books", async () => {
    const { calls, dependencies } = createHarness({
        book: ownedBook({ fileType: "pdf" }),
    });

    assert.deepEqual(
        await getOwnedReaderManifest(bookId, userId, dependencies),
        {
            kind: "unsupported",
        }
    );
    assert.deepEqual(calls.enqueues, []);
});

test("getOwnedReaderManifest auto-enqueues not_requested books as processing", async () => {
    const { calls, dependencies } = createHarness({
        book: ownedBook({ readerPackageStatus: "not_requested" }),
    });

    assert.deepEqual(
        await getOwnedReaderManifest(bookId, userId, dependencies),
        {
            kind: "processing",
        }
    );
    assert.deepEqual(calls.enqueues, [{ bookId, userId, resetFailed: false }]);
    assert.deepEqual(calls.marks, [{ bookId, userId }]);
});

test("getOwnedReaderManifest returns processing without re-enqueue", async () => {
    const { calls, dependencies } = createHarness({
        book: ownedBook({ readerPackageStatus: "processing" }),
    });

    assert.deepEqual(
        await getOwnedReaderManifest(bookId, userId, dependencies),
        {
            kind: "processing",
        }
    );
    assert.deepEqual(calls.enqueues, []);
});

test("getOwnedReaderManifest returns failed with stored error", async () => {
    const { dependencies } = createHarness({
        book: ownedBook({
            readerPackageStatus: "failed",
            readerPackageError: "boom",
        }),
    });

    assert.deepEqual(
        await getOwnedReaderManifest(bookId, userId, dependencies),
        {
            kind: "failed",
            error: "boom",
        }
    );
});

test("getOwnedReaderManifest returns ready manifest with cover and toc fallback", async () => {
    const generatedAt = new Date("2026-02-01T00:00:00.000Z");
    const { calls, dependencies } = createHarness({
        book: ownedBook({
            readerPackageStatus: "ready",
            readerPackageGeneratedAt: generatedAt,
            readerPackageToc: null,
        }),
        chapters: [
            {
                id: "c1",
                title: null,
                href: "c1.xhtml",
                chapterOrder: 0,
                blocks: [{ id: "b1", html: "<p>Hi</p>", text: "Hi" }],
            },
        ],
        resources: [
            {
                id: "cover",
                mediaType: "image/jpeg",
                size: 12,
                isCover: true,
            },
            {
                id: "other",
                mediaType: "image/png",
                size: 4,
                isCover: false,
            },
        ],
    });

    assert.deepEqual(
        await getOwnedReaderManifest(bookId, userId, dependencies),
        {
            kind: "ready",
            manifest: {
                bookId,
                title: "Owned EPUB",
                creator: "Author",
                status: "ready",
                chapters: [
                    {
                        id: "c1",
                        title: null,
                        href: "c1.xhtml",
                        order: 0,
                        firstBlockId: "b1",
                    },
                ],
                toc: [
                    {
                        title: "Chapter 1",
                        level: 0,
                        chapterId: "c1",
                        blockId: "b1",
                    },
                ],
                resources: [
                    { id: "cover", mediaType: "image/jpeg", size: 12 },
                    { id: "other", mediaType: "image/png", size: 4 },
                ],
                coverResourceId: "cover",
                generatedAt: generatedAt.toISOString(),
            },
        }
    );
    assert.deepEqual(calls.chapters, [bookId]);
    assert.deepEqual(calls.resources, [bookId]);
});

test("getOwnedReaderManifest falls back to the first image resource", async () => {
    const { dependencies } = createHarness({
        book: ownedBook({
            readerPackageStatus: "ready",
            readerPackageGeneratedAt: new Date("2026-02-01T00:00:00.000Z"),
        }),
        resources: [
            {
                id: "inline-image",
                mediaType: "image/png",
                size: 4,
                isCover: false,
            },
        ],
    });

    const result = await getOwnedReaderManifest(bookId, userId, dependencies);
    assert.equal(
        result.kind === "ready" ? result.manifest.coverResourceId : null,
        "inline-image"
    );
});

test("getOwnedReaderChapter returns null when the chapter is missing", async () => {
    const { calls, dependencies } = createHarness({ chapter: null });

    assert.equal(
        await getOwnedReaderChapter(bookId, "missing", userId, dependencies),
        null
    );
    assert.deepEqual(calls.chapterLooks, [
        { bookId, chapterId: "missing", userId },
    ]);
});

test("getOwnedReaderResource returns null when the resource is missing", async () => {
    const { calls, dependencies } = createHarness({ resource: null });

    assert.equal(
        await getOwnedReaderResource(bookId, "missing", userId, dependencies),
        null
    );
    assert.deepEqual(calls.resourceLooks, [
        { bookId, resourceId: "missing", userId },
    ]);
    assert.deepEqual(calls.files, []);
});

test("enqueueReaderPackage retry resets failed attempts", async () => {
    const { calls, dependencies } = createHarness({
        book: ownedBook({
            readerPackageStatus: "failed",
            readerPackageError: "boom",
        }),
    });

    assert.equal(
        await enqueueReaderPackage(bookId, userId, true, dependencies),
        true
    );
    assert.deepEqual(calls.enqueues, [{ bookId, userId, resetFailed: true }]);
    assert.deepEqual(calls.marks, [{ bookId, userId }]);
});

test("enqueueReaderPackage rejects missing or non-EPUB books", async () => {
    const missing = createHarness({ book: null });
    assert.equal(
        await enqueueReaderPackage(bookId, userId, true, missing.dependencies),
        false
    );

    const pdf = createHarness({ book: ownedBook({ fileType: "pdf" }) });
    assert.equal(
        await enqueueReaderPackage(bookId, userId, true, pdf.dependencies),
        false
    );
    assert.deepEqual(pdf.calls.enqueues, []);
});

test("generateAndPersistReaderPackage rejects missing or non-epub books", async () => {
    await assert.rejects(
        () =>
            generateAndPersistReaderPackage(bookId, userId, {
                repository: createHarness().dependencies.repository,
                getFile: async () => Buffer.from("x"),
                findOwnedBookRow: async () => null,
            }),
        /Owned EPUB was not found/
    );
    await assert.rejects(
        () =>
            generateAndPersistReaderPackage(bookId, userId, {
                repository: createHarness().dependencies.repository,
                getFile: async () => Buffer.from("x"),
                findOwnedBookRow: async () => ({
                    id: bookId,
                    userId,
                    fileKey: "k",
                    fileType: "pdf",
                }),
            }),
        /Owned EPUB was not found/
    );
});

test("generateAndPersistReaderPackage uploads, persists, and cleans up on failure", async () => {
    const uploaded: string[] = [];
    const deleted: string[] = [];
    let persistCalls = 0;

    await generateAndPersistReaderPackage(bookId, userId, {
        repository: createHarness().dependencies.repository,
        getFile: async (key) => {
            assert.equal(key, "epub-key");
            return Buffer.from("epub-bytes");
        },
        findOwnedBookRow: async () => ({
            id: bookId,
            userId,
            fileKey: "epub-key",
            fileType: "epub",
        }),
        buildReaderPackage: async () =>
            ({
                chapters: [
                    {
                        id: "c1",
                        title: "One",
                        href: "c1.xhtml",
                        order: 0,
                        blocks: [{ id: "b1", html: "<p>Hi</p>", text: "Hi" }],
                    },
                ],
                resources: [
                    {
                        id: "img1",
                        mediaType: "image/png",
                        bytes: new Uint8Array([1, 2, 3]),
                        isCover: true,
                    },
                ],
                toc: [
                    { title: "One", level: 0, chapterId: "c1", blockId: "b1" },
                ],
            }) as any,
        uploadFile: async (key, file) => {
            uploaded.push(key);
            assert.deepEqual(file, Buffer.from([1, 2, 3]));
        },
        deleteFile: async (key) => {
            deleted.push(key);
        },
        persistGeneratedPackage: async () => {
            persistCalls += 1;
        },
    });
    assert.equal(persistCalls, 1);
    assert.equal(uploaded.length, 1);
    assert.equal(deleted.length, 0);

    await assert.rejects(
        () =>
            generateAndPersistReaderPackage(bookId, userId, {
                repository: createHarness().dependencies.repository,
                getFile: async () => Buffer.from("epub-bytes"),
                findOwnedBookRow: async () => ({
                    id: bookId,
                    userId,
                    fileKey: "epub-key",
                    fileType: "epub",
                }),
                buildReaderPackage: async () =>
                    ({ chapters: [], resources: [], toc: [] }) as any,
            }),
        /no readable chapters/
    );

    const failedUploads: string[] = [];
    const cleaned: string[] = [];
    await assert.rejects(
        () =>
            generateAndPersistReaderPackage(bookId, userId, {
                repository: createHarness().dependencies.repository,
                getFile: async () => Buffer.from("epub-bytes"),
                findOwnedBookRow: async () => ({
                    id: bookId,
                    userId,
                    fileKey: "epub-key",
                    fileType: "epub",
                }),
                buildReaderPackage: async () =>
                    ({
                        chapters: [
                            {
                                id: "c1",
                                title: "One",
                                href: "c1.xhtml",
                                order: 0,
                                blocks: [
                                    { id: "b1", html: "<p>Hi</p>", text: "Hi" },
                                ],
                            },
                        ],
                        resources: [
                            {
                                id: "img1",
                                mediaType: "image/png",
                                bytes: new Uint8Array([9]),
                                isCover: false,
                            },
                        ],
                        toc: [],
                    }) as any,
                uploadFile: async (key) => {
                    failedUploads.push(`fail:${key}`);
                },
                deleteFile: async (key) => {
                    cleaned.push(key);
                },
                persistGeneratedPackage: async () => {
                    throw new Error("persist failed");
                },
            }),
        /persist failed/
    );
    assert.ok(cleaned.some((key) => key.includes("/reader/img1")));
    assert.equal(failedUploads.length, 1);
});

test("processNextReaderPackageJob returns false when idle and handles success/failure", async () => {
    const idlePool = {
        async query() {
            return { rowCount: 0, rows: [] };
        },
        async connect() {
            return {
                async query(sql: string) {
                    if (String(sql).includes("FOR UPDATE SKIP LOCKED")) {
                        return { rows: [] };
                    }
                    return { rows: [] };
                },
                release() {},
            };
        },
    };
    assert.equal(
        await processNextReaderPackageJob({
            repository: createHarness().dependencies.repository,
            getFile: async () => Buffer.from("x"),
            pool: idlePool as any,
        }),
        false
    );

    const makeBusyPool = () => {
        let claimCount = 0;
        return {
            async query() {
                return { rowCount: 1, rows: [] };
            },
            async connect() {
                return {
                    async query(sql: string) {
                        if (String(sql).includes("FOR UPDATE SKIP LOCKED")) {
                            claimCount += 1;
                            return {
                                rows: [
                                    {
                                        id: `job-${claimCount}`,
                                        book_id: bookId,
                                        user_id: userId,
                                        attempts: claimCount === 2 ? 3 : 0,
                                        max_attempts: 3,
                                    },
                                ],
                            };
                        }
                        return { rows: [] };
                    },
                    release() {},
                };
            },
        };
    };

    let generated = false;
    const busy = makeBusyPool();
    assert.equal(
        await processNextReaderPackageJob({
            repository: createHarness().dependencies.repository,
            getFile: async () => Buffer.from("x"),
            pool: busy as any,
            generateAndPersistReaderPackage: async () => {
                generated = true;
            },
        }),
        true
    );
    assert.equal(generated, true);

    assert.equal(
        await processNextReaderPackageJob({
            repository: createHarness().dependencies.repository,
            getFile: async () => Buffer.from("x"),
            pool: makeBusyPool() as any,
            generateAndPersistReaderPackage: async () => {
                throw new Error("package boom");
            },
        }),
        true
    );
});

test("getOwnedReaderChapter returns the owned chapter payload", async () => {
    const chapter = {
        id: "c1",
        title: "One",
        href: "c1.xhtml",
        order: 0,
        blocks: [{ id: "b1", html: "<p>Hi</p>", text: "Hi" }],
    };
    const { calls, dependencies } = createHarness({ chapter });

    assert.deepEqual(
        await getOwnedReaderChapter(bookId, "c1", userId, dependencies),
        { bookId, ...chapter }
    );
    assert.deepEqual(calls.chapterLooks, [{ bookId, chapterId: "c1", userId }]);
});

test("getOwnedReaderResource returns media type and file bytes", async () => {
    const { calls, dependencies } = createHarness({
        resource: {
            storageKey: "users/u/books/b/reader/cover",
            mediaType: "image/jpeg",
        },
        fileBytes: Buffer.from("image-bytes"),
    });

    assert.deepEqual(
        await getOwnedReaderResource(bookId, "cover", userId, dependencies),
        {
            mediaType: "image/jpeg",
            bytes: Buffer.from("image-bytes"),
        }
    );
    assert.deepEqual(calls.resourceLooks, [
        { bookId, resourceId: "cover", userId },
    ]);
    assert.deepEqual(calls.files, ["users/u/books/b/reader/cover"]);
});
