import assert from "node:assert/strict";
import test from "node:test";
import type { SelectBook } from "../src/db/schema";
import { publicBookSelection, toPublicBook } from "../src/services/PublicBook";

const privateBook: SelectBook = {
    id: "book-1",
    title: "A book",
    originalFilename: "wrong-name.epub",
    embeddedTitle: "A book",
    creator: "An Author",
    identifier: "urn:isbn:test",
    metadataExtractedAt: new Date("2026-01-01T00:00:00.000Z"),
    userId: "user-1",
    fileKey: "private/storage-key",
    fileType: "epub",
    collectionName: "private_collection",
    processingStatus: "processing",
    processingError: null,
    readerPackageStatus: "not_requested",
    readerPackageError: null,
    readerPackageGeneratedAt: null,
    readerPackageToc: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

test("public list and upload projection contains only browser book metadata", () => {
    const expectedKeys = [
        "createdAt",
        "fileType",
        "id",
        "processingError",
        "processingStatus",
        "title",
    ];

    assert.deepEqual(Object.keys(publicBookSelection).sort(), expectedKeys);
    assert.deepEqual(
        Object.keys(toPublicBook(privateBook)).sort(),
        expectedKeys
    );
    assert.equal("fileKey" in toPublicBook(privateBook), false);
    assert.equal("collectionName" in toPublicBook(privateBook), false);
    assert.equal("userId" in toPublicBook(privateBook), false);
});
