import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import type { SelectBook } from "../src/db/schema";
import { toPublicBook } from "../src/services/PublicBook";

const migrationPath = existsSync(
    "migrations/0013_backfill_legacy_book_file_types.sql"
)
    ? "migrations/0013_backfill_legacy_book_file_types.sql"
    : "apps/api/migrations/0013_backfill_legacy_book_file_types.sql";
const migrationRoot = migrationPath.slice(0, migrationPath.lastIndexOf("/"));

test("0013 backfills only known null legacy book key formats", () => {
    const migration = readFileSync(migrationPath, "utf8");

    assert.match(migration, /"file_type" IS NULL/);
    assert.match(migration, /"file_key" LIKE 'pdf-%'/);
    assert.match(migration, /THEN 'pdf'::"file_type"/);
    assert.match(migration, /"file_key" LIKE 'epub-%'/);
    assert.match(migration, /THEN 'epub'::"file_type"/);
    assert.doesNotMatch(migration, /ELSE/);
    assert.doesNotMatch(
        migration,
        /CREATE (?:TABLE|TYPE|INDEX)|ALTER TABLE/i
    );
});

test("0013 follows the manual 0012 journal entry without generated DDL metadata", () => {
    const journal = JSON.parse(
        readFileSync(`${migrationRoot}/meta/_journal.json`, "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> };
    const lastEntries = journal.entries
        .slice(-2)
        .map(({ idx, tag }) => ({ idx, tag }));

    assert.deepEqual(lastEntries, [
        { idx: 12, tag: "0012_lightsail_pgvector_jobs" },
        { idx: 13, tag: "0013_backfill_legacy_book_file_types" },
    ]);
    assert.equal(existsSync(`${migrationRoot}/meta/0012_snapshot.json`), false);
    assert.equal(existsSync(`${migrationRoot}/meta/0013_snapshot.json`), false);
});

test("a backfilled legacy PDF is projected publicly as a PDF", () => {
    const migratedBook: SelectBook = {
        id: "legacy-pdf-book-id",
        title: "Legacy PDF",
        userId: "user-1",
        fileKey: "pdf-0123456789ab",
        fileType: "pdf",
        collectionName: null,
        processingStatus: "failed",
        processingError: null,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
    };

    const publicBook = toPublicBook(migratedBook);
    assert.equal(publicBook.fileType, "pdf");
    assert.equal("fileKey" in publicBook, false);
});
