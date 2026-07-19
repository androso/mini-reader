import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const migrationPath = "migrations/0014_mighty_rattler.sql";
const migrationTestDatabaseUrl =
    process.env.PROGRESS_MIGRATION_TEST_DATABASE_URL;

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}

test(
    "0014 migrates legacy progress in a disposable PostgreSQL 16/pgvector database",
    {
        skip: migrationTestDatabaseUrl
            ? false
            : "requires PROGRESS_MIGRATION_TEST_DATABASE_URL",
    },
    async () => {
        assert.ok(migrationTestDatabaseUrl);

        const adminUrl = new URL(migrationTestDatabaseUrl);
        const disposableDatabase = `reader_progress_${randomUUID().replace(/-/g, "")}`;
        const testUrl = new URL(adminUrl);
        testUrl.pathname = `/${disposableDatabase}`;
        const admin = new Client({ connectionString: adminUrl.toString() });
        let databaseCreated = false;

        await admin.connect();
        try {
            const version = await admin.query<{ server_version_num: string }>(
                "SHOW server_version_num"
            );
            assert.ok(
                Number(version.rows[0].server_version_num) >= 160000,
                "migration tests require PostgreSQL 16 or newer"
            );

            await admin.query(
                `CREATE DATABASE ${quoteIdentifier(disposableDatabase)}`
            );
            databaseCreated = true;

            const database = new Client({
                connectionString: testUrl.toString(),
            });
            await database.connect();
            try {
                await database.query('CREATE EXTENSION IF NOT EXISTS "vector"');
                await database.query(`
                    CREATE TABLE "users" (
                        "id" uuid PRIMARY KEY,
                        "email" text NOT NULL
                    );
                    CREATE TABLE "books" (
                        "id" uuid PRIMARY KEY,
                        "user_id" uuid NOT NULL,
                        "file_key" text NOT NULL,
                        "created_at" timestamp NOT NULL
                    );
                    CREATE TABLE "progress" (
                        "user_id" uuid NOT NULL,
                        "book_id" text NOT NULL,
                        "progress_position" text NOT NULL,
                        "progress_chapter" text NOT NULL,
                        "last_read_at" timestamptz NOT NULL,
                        "created_at" timestamptz NOT NULL,
                        "updated_at" timestamptz NOT NULL
                    );
                `);

                const userA = "10000000-0000-4000-8000-000000000001";
                const userB = "10000000-0000-4000-8000-000000000002";
                const missingUser = "10000000-0000-4000-8000-000000000003";
                const oldBookA = "20000000-0000-4000-8000-000000000001";
                const newBookA = "20000000-0000-4000-8000-000000000002";
                const bookB = "20000000-0000-4000-8000-000000000003";
                const directBook = "20000000-0000-4000-8000-000000000004";
                const orphanBook = "20000000-0000-4000-8000-000000000099";

                await database.query(
                    `INSERT INTO "users" ("id", "email") VALUES ($1, 'a@example.com'), ($2, 'b@example.com')`,
                    [userA, userB]
                );
                await database.query(
                    `INSERT INTO "books" ("id", "user_id", "file_key", "created_at") VALUES
                        ($1, $5, 'shared-key', '2025-01-01'),
                        ($2, $5, 'shared-key', '2025-02-01'),
                        ($3, $6, 'shared-key', '2025-03-01'),
                        ($4, $5, 'direct-key', '2025-04-01')`,
                    [oldBookA, newBookA, bookB, directBook, userA, userB]
                );

                const insertProgress = async (
                    userId: string,
                    bookId: string,
                    position: string,
                    updatedAt: string,
                    lastReadAt = "2025-01-01T00:00:00Z",
                    createdAt = "2025-01-01T00:00:00Z"
                ) => {
                    await database.query(
                        `INSERT INTO "progress" (
                            "user_id", "book_id", "progress_position", "progress_chapter",
                            "updated_at", "last_read_at", "created_at"
                        ) VALUES ($1, $2, $3, 'chapter', $4, $5, $6)`,
                        [
                            userId,
                            bookId,
                            position,
                            updatedAt,
                            lastReadAt,
                            createdAt,
                        ]
                    );
                };

                await insertProgress(
                    userA,
                    "shared-key",
                    "older-legacy",
                    "2025-02-01T00:00:00Z"
                );
                await insertProgress(
                    userA,
                    "shared-key",
                    "newer-legacy",
                    "2025-03-01T00:00:00Z"
                );
                await insertProgress(
                    userB,
                    "shared-key",
                    "other-owner",
                    "2025-04-01T00:00:00Z"
                );
                await insertProgress(
                    userA,
                    directBook,
                    "lower-last-read",
                    "2025-05-01T00:00:00Z",
                    "2025-05-01T00:00:00Z"
                );
                await insertProgress(
                    userA,
                    directBook,
                    "lower-created",
                    "2025-05-01T00:00:00Z",
                    "2025-06-01T00:00:00Z",
                    "2025-05-01T00:00:00Z"
                );
                await insertProgress(
                    userA,
                    directBook,
                    "lower-ctid",
                    "2025-05-01T00:00:00Z",
                    "2025-06-01T00:00:00Z",
                    "2025-06-01T00:00:00Z"
                );
                await insertProgress(
                    userA,
                    directBook,
                    "kept-by-ctid",
                    "2025-05-01T00:00:00Z",
                    "2025-06-01T00:00:00Z",
                    "2025-06-01T00:00:00Z"
                );
                await insertProgress(
                    userA,
                    "malformed",
                    "delete-malformed",
                    "2025-01-01T00:00:00Z"
                );
                await insertProgress(
                    userA,
                    orphanBook,
                    "delete-orphan",
                    "2025-01-01T00:00:00Z"
                );
                await insertProgress(
                    missingUser,
                    directBook,
                    "delete-missing-user",
                    "2025-01-01T00:00:00Z"
                );

                const migration = readFileSync(migrationPath, "utf8");
                await database.query(migration);

                const rows = await database.query<{
                    user_id: string;
                    book_id: string;
                    progress_position: string;
                }>(
                    `SELECT "user_id", "book_id", "progress_position" FROM "progress" ORDER BY "user_id", "book_id"`
                );
                assert.deepEqual(rows.rows, [
                    {
                        user_id: userA,
                        book_id: newBookA,
                        progress_position: "newer-legacy",
                    },
                    {
                        user_id: userA,
                        book_id: directBook,
                        progress_position: "kept-by-ctid",
                    },
                    {
                        user_id: userB,
                        book_id: bookB,
                        progress_position: "other-owner",
                    },
                ]);

                const column = await database.query<{ data_type: string }>(`
                    SELECT "data_type" FROM "information_schema"."columns"
                    WHERE "table_schema" = 'public' AND "table_name" = 'progress' AND "column_name" = 'book_id'
                `);
                assert.equal(column.rows[0].data_type, "uuid");

                const constraints = await database.query<{
                    conname: string;
                    contype: string;
                    confdeltype: string;
                }>(`
                    SELECT "conname", "contype", "confdeltype"
                    FROM "pg_constraint"
                    WHERE "conrelid" = 'public.progress'::regclass
                    ORDER BY "conname"
                `);
                assert.deepEqual(constraints.rows, [
                    {
                        conname: "progress_book_id_books_id_fk",
                        contype: "f",
                        confdeltype: "c",
                    },
                    {
                        conname: "progress_user_id_book_id_pk",
                        contype: "p",
                        confdeltype: " ",
                    },
                    {
                        conname: "progress_user_id_users_id_fk",
                        contype: "f",
                        confdeltype: "c",
                    },
                ]);

                await database.query('DELETE FROM "books" WHERE "id" = $1', [
                    newBookA,
                ]);
                assert.equal(
                    (
                        await database.query(
                            'SELECT 1 FROM "progress" WHERE "book_id" = $1',
                            [newBookA]
                        )
                    ).rowCount,
                    0
                );
                await database.query('DELETE FROM "users" WHERE "id" = $1', [
                    userB,
                ]);
                assert.equal(
                    (
                        await database.query(
                            'SELECT 1 FROM "progress" WHERE "user_id" = $1',
                            [userB]
                        )
                    ).rowCount,
                    0
                );
            } finally {
                await database.end();
            }
        } finally {
            if (databaseCreated) {
                await admin.query(
                    `SELECT pg_terminate_backend("pid") FROM "pg_stat_activity" WHERE "datname" = $1`,
                    [disposableDatabase]
                );
                await admin.query(
                    `DROP DATABASE ${quoteIdentifier(disposableDatabase)}`
                );
            }
            await admin.end();
        }
    }
);

test("0014 snapshot records the UUID key and named cascading constraints", () => {
    const snapshot = JSON.parse(
        readFileSync("migrations/meta/0014_snapshot.json", "utf8")
    );
    const progress = snapshot.tables["public.progress"];

    assert.equal(progress.columns.book_id.type, "uuid");
    assert.deepEqual(
        progress.compositePrimaryKeys.progress_user_id_book_id_pk.columns,
        ["user_id", "book_id"]
    );
    assert.equal(
        progress.foreignKeys.progress_book_id_books_id_fk.onDelete,
        "cascade"
    );
    assert.equal(
        progress.foreignKeys.progress_user_id_users_id_fk.onDelete,
        "cascade"
    );
});
