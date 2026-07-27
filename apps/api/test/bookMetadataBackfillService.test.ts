import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractedBookMetadata } from "@reader/processing";
import {
    backfillBookMetadata,
    type BookMetadataBackfillRecord,
} from "../src/services/BookMetadataBackfillService";

const legacyBook: BookMetadataBackfillRecord = {
    id: "11111111-1111-1111-1111-111111111111",
    userId: "user-1",
    fileKey: "private-key",
    fileType: "epub",
};

const metadata: ExtractedBookMetadata = {
    title: "The Left Hand of Darkness",
    creator: "Ursula K. Le Guin",
    identifier: "urn:isbn:test",
};

test("backfill publishes embedded metadata exactly once", async () => {
    let eligible = true;
    const updates: ExtractedBookMetadata[] = [];
    const run = () =>
        backfillBookMetadata({
            listBatch: async () => (eligible ? [legacyBook] : []),
            getFile: async () => Buffer.from("book"),
            extractMetadata: async () => metadata,
            markExtracted: async (_book, extracted) => {
                eligible = false;
                updates.push(extracted);
                return true;
            },
        });

    assert.deepEqual(await run(), { processed: 1, updated: 1, failed: 0 });
    assert.deepEqual(await run(), { processed: 0, updated: 0, failed: 0 });
    assert.deepEqual(updates, [metadata]);
});

test("backfill records empty metadata while preserving the display title", async () => {
    const empty: ExtractedBookMetadata = {
        title: null,
        creator: null,
        identifier: null,
    };
    let captured: ExtractedBookMetadata | undefined;
    const result = await backfillBookMetadata({
        listBatch: async (afterId) => (afterId === null ? [legacyBook] : []),
        getFile: async () => Buffer.from("book"),
        extractMetadata: async () => empty,
        markExtracted: async (_book, extracted) => {
            captured = extracted;
            return true;
        },
    });

    assert.deepEqual(result, { processed: 1, updated: 1, failed: 0 });
    assert.deepEqual(captured, empty);
    assert.equal(captured?.title, null);
});

test("backfill reports extraction failures and leaves the row retryable", async () => {
    const failures: string[] = [];
    const dependencies = {
        listBatch: async (afterId: string | null) =>
            afterId === null ? [legacyBook] : [],
        getFile: async () => {
            throw new Error("object unavailable");
        },
        extractMetadata: async () => metadata,
        markExtracted: async () => true,
        onBookFailure: (bookId: string) => failures.push(bookId),
    };

    assert.deepEqual(await backfillBookMetadata(dependencies), {
        processed: 1,
        updated: 0,
        failed: 1,
    });
    assert.deepEqual(await backfillBookMetadata(dependencies), {
        processed: 1,
        updated: 0,
        failed: 1,
    });
    assert.deepEqual(failures, [legacyBook.id, legacyBook.id]);
});

test("backfill does not overwrite a concurrently changed row", async () => {
    const result = await backfillBookMetadata({
        listBatch: async (afterId) => (afterId === null ? [legacyBook] : []),
        getFile: async () => Buffer.from("book"),
        extractMetadata: async () => metadata,
        markExtracted: async () => false,
    });

    assert.deepEqual(result, { processed: 1, updated: 0, failed: 0 });
});
