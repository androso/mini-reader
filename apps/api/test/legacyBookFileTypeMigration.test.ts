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
    assert.doesNotMatch(migration, /CREATE (?:TABLE|TYPE|INDEX)|ALTER TABLE/i);
});

test("0013 follows the manual 0012 schema without losing its objects", () => {
    const journal = JSON.parse(
        readFileSync(`${migrationRoot}/meta/_journal.json`, "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> };
    const migrationSequence = journal.entries
        .filter(({ idx }) => idx >= 12 && idx <= 15)
        .map(({ idx, tag }) => ({ idx, tag }));

    assert.deepEqual(migrationSequence, [
        { idx: 12, tag: "0012_lightsail_pgvector_jobs" },
        { idx: 13, tag: "0013_backfill_legacy_book_file_types" },
        { idx: 14, tag: "0014_mighty_rattler" },
        { idx: 15, tag: "0015_daffy_runaways" },
    ]);

    const snapshot0011 = JSON.parse(
        readFileSync(`${migrationRoot}/meta/0011_snapshot.json`, "utf8")
    ) as { id: string };
    const snapshot0013 = JSON.parse(
        readFileSync(`${migrationRoot}/meta/0013_snapshot.json`, "utf8")
    ) as {
        id: string;
        prevId: string;
        version: string;
        dialect: string;
        tables: Record<
            string,
            {
                columns: Record<string, { type: string }>;
                indexes: Record<string, { isUnique: boolean }>;
                foreignKeys: Record<string, { onDelete: string }>;
            }
        >;
        enums: Record<string, { values: string[] }>;
    };

    assert.equal(existsSync(`${migrationRoot}/meta/0012_snapshot.json`), false);
    assert.notEqual(snapshot0013.id, snapshot0011.id);
    assert.equal(snapshot0013.prevId, snapshot0011.id);
    assert.equal(snapshot0013.version, "7");
    assert.equal(snapshot0013.dialect, "postgresql");

    const chunks = snapshot0013.tables["public.book_search_chunks"];
    assert.equal(chunks.columns.embedding.type, "vector(1536)");

    const jobs = snapshot0013.tables["public.book_processing_jobs"];
    assert.equal(jobs.columns.status.type, "book_processing_job_status");
    assert.equal(jobs.indexes.book_processing_jobs_book_id_idx.isUnique, true);
    assert.equal(jobs.indexes.book_processing_jobs_due_idx.isUnique, false);
    assert.equal(
        jobs.foreignKeys.book_processing_jobs_book_id_books_id_fk.onDelete,
        "cascade"
    );
    assert.deepEqual(
        snapshot0013.enums["public.book_processing_job_status"].values,
        ["queued", "processing", "retrying", "completed", "failed"]
    );
});

test("a backfilled legacy PDF is projected publicly as a PDF", () => {
    const migratedBook: SelectBook = {
        id: "legacy-pdf-book-id",
        title: "Legacy PDF",
        originalFilename: "Legacy PDF.pdf",
        embeddedTitle: null,
        creator: null,
        identifier: null,
        metadataExtractedAt: null,
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
