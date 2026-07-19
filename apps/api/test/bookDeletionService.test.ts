import assert from "node:assert/strict";
import test from "node:test";
import {
    BookDeletionForbiddenError,
    type BookDeletionDependencies,
    BookDeletionNotFoundError,
    type DeletableBook,
    deleteBookCollectionArtifacts,
    deleteOwnedBook,
} from "../src/services/BookDeletionService";

const bookId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

const createHarness = ({
    initialBook = {
        id: bookId,
        userId,
        fileKey: "legacy/shared-original",
        collectionName: "legacy_shared_collection",
        processingStatus: "processing",
    },
    fileReferences = 0,
    collectionReferences = 0,
    failFileOnce = false,
    artifactsMissing = false,
    failSearch = false,
}: {
    initialBook?: DeletableBook | null;
    fileReferences?: number;
    collectionReferences?: number;
    failFileOnce?: boolean;
    artifactsMissing?: boolean;
    failSearch?: boolean;
} = {}) => {
    let book = initialBook ? { ...initialBook } : null;
    let shouldFailFile = failFileOnce;
    const events: string[] = [];
    const missingFileError = Object.assign(new Error("file not found"), {
        code: "NoSuchKey",
    });
    const missingCollectionError = Object.assign(
        new Error("collection not found"),
        {
            status: 404,
        }
    );
    const dependencies: BookDeletionDependencies = {
        repository: {
            findBook: async () => {
                events.push("findBook");
                return book ? { ...book } : null;
            },
            markDeleting: async () => {
                events.push("markDeleting");
                if (!book) return null;
                book.processingStatus = "deleting";
                return { ...book };
            },
            deleteProcessingJob: async () => {
                events.push("deleteJob");
            },
            countOtherFileReferences: async () => {
                events.push("countFileReferences");
                return fileReferences;
            },
            countOtherCollectionReferences: async () => {
                events.push("countCollectionReferences");
                return collectionReferences;
            },
            deleteBook: async () => {
                events.push("deleteBook");
                book = null;
            },
        },
        artifacts: {
            deleteFile: async (fileKey) => {
                events.push(`deleteFile:${fileKey}`);
                if (shouldFailFile) {
                    shouldFailFile = false;
                    throw new Error("storage unavailable");
                }
                if (artifactsMissing) throw missingFileError;
            },
            deleteVectorCollection: async (collectionName) => {
                events.push(`deleteVector:${collectionName}`);
                if (artifactsMissing) throw missingCollectionError;
            },
            deleteSearchChunks: async (collectionName) => {
                events.push(`deleteSearch:${collectionName}`);
                if (failSearch) throw new Error("database unavailable");
            },
            clearCollectionCache: (collectionName) => {
                events.push(`clearCache:${collectionName}`);
            },
        },
    };
    return { dependencies, events, getBook: () => book };
};

test("missing and non-owned books retain the route's 404 and 403 boundaries", async () => {
    const missing = createHarness({ initialBook: null });
    await assert.rejects(
        deleteOwnedBook(bookId, userId, missing.dependencies),
        BookDeletionNotFoundError
    );
    assert.deepEqual(missing.events, ["findBook"]);

    const forbidden = createHarness({
        initialBook: {
            id: bookId,
            userId: "33333333-3333-4333-8333-333333333333",
            fileKey: "private",
            collectionName: null,
            processingStatus: "ready",
        },
    });
    await assert.rejects(
        deleteOwnedBook(bookId, userId, forbidden.dependencies),
        BookDeletionForbiddenError
    );
    assert.deepEqual(forbidden.events, ["findBook"]);
});

test("deletion gates the book and removes its queued job before artifacts", async () => {
    const harness = createHarness();

    await deleteOwnedBook(bookId, userId, harness.dependencies);

    assert.equal(harness.getBook(), null);
    assert.deepEqual(harness.events, [
        "findBook",
        "markDeleting",
        "deleteJob",
        "countFileReferences",
        "deleteFile:legacy/shared-original",
        "countCollectionReferences",
        "deleteVector:legacy_shared_collection",
        "deleteSearch:legacy_shared_collection",
        "clearCache:legacy_shared_collection",
        "deleteBook",
    ]);
});

test("non-deleting legacy references protect shared file and collection artifacts", async () => {
    const harness = createHarness({
        fileReferences: 1,
        collectionReferences: 1,
    });

    await deleteOwnedBook(bookId, userId, harness.dependencies);

    assert.equal(harness.getBook(), null);
    assert.equal(
        harness.events.some((event) => event.startsWith("deleteFile:")),
        false
    );
    assert.equal(
        harness.events.some((event) => event.startsWith("deleteVector:")),
        false
    );
    assert.equal(
        harness.events.some((event) => event.startsWith("deleteSearch:")),
        false
    );
});

test("a null stored collection cleans the collection derived from the book ID", async () => {
    const harness = createHarness({
        initialBook: {
            id: bookId,
            userId,
            fileKey: "private",
            collectionName: null,
            processingStatus: "ready",
        },
    });

    await deleteOwnedBook(bookId, userId, harness.dependencies);

    const derived = "book_11111111_1111_4111_8111_111111111111";
    assert.ok(harness.events.includes(`deleteVector:${derived}`));
    assert.ok(harness.events.includes(`deleteSearch:${derived}`));
    assert.ok(harness.events.includes(`clearCache:${derived}`));
});

test("missing artifacts are idempotent and still allow row deletion", async () => {
    const harness = createHarness({ artifactsMissing: true });

    await deleteOwnedBook(bookId, userId, harness.dependencies);

    assert.equal(harness.getBook(), null);
    assert.ok(harness.events.includes("deleteBook"));
});

test("cleanup failure leaves deleting state and a repeated DELETE finishes cleanup", async () => {
    const harness = createHarness({ failFileOnce: true });

    await assert.rejects(
        deleteOwnedBook(bookId, userId, harness.dependencies),
        /storage unavailable/
    );
    assert.equal(harness.getBook()?.processingStatus, "deleting");
    assert.equal(harness.events.includes("deleteBook"), false);

    await deleteOwnedBook(bookId, userId, harness.dependencies);

    assert.equal(harness.getBook(), null);
    assert.equal(
        harness.events.filter((event) => event === "deleteJob").length,
        2
    );
});

test("search cleanup failures are not mistaken for absent artifacts", async () => {
    const harness = createHarness({ failSearch: true });

    await assert.rejects(
        deleteOwnedBook(bookId, userId, harness.dependencies),
        /database unavailable/
    );

    assert.equal(harness.getBook()?.processingStatus, "deleting");
    assert.equal(harness.events.includes("deleteBook"), false);
});

test("late-publication cleanup deletes vector, search, and cache artifacts", async () => {
    const events: string[] = [];
    await deleteBookCollectionArtifacts("book_late", {
        deleteVectorCollection: async () => {
            events.push("vector");
        },
        deleteSearchChunks: async () => {
            events.push("search");
        },
        clearCollectionCache: () => {
            events.push("cache");
        },
    });
    assert.deepEqual(events, ["vector", "search", "cache"]);
});
