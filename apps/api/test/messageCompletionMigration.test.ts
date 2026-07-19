import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationRoot = existsSync("migrations/0015_daffy_runaways.sql")
    ? "migrations"
    : "apps/api/migrations";
const migration = readFileSync(
    `${migrationRoot}/0015_daffy_runaways.sql`,
    "utf8"
);
const snapshot = JSON.parse(
    readFileSync(`${migrationRoot}/meta/0015_snapshot.json`, "utf8")
) as {
    enums: Record<string, { values: string[] }>;
    tables: Record<string, { columns: Record<string, { notNull: boolean }> }>;
};

test("0015 adds nullable completion fields and backfills assistants only", () => {
    assert.match(
        migration,
        /CREATE TYPE "public"\."message_completion_status" AS ENUM\('complete', 'truncated', 'cancelled', 'failed'\)/
    );
    assert.match(migration, /ADD COLUMN "completion_status"/);
    assert.match(migration, /ADD COLUMN "finish_reason" text/);
    assert.match(
        migration,
        /UPDATE "messages"[\s\S]*SET "completion_status" = 'complete'[\s\S]*WHERE "role" = 'assistant'/
    );
    assert.doesNotMatch(migration, /WHERE "role" = 'user'/);

    assert.deepEqual(
        snapshot.enums["public.message_completion_status"].values,
        ["complete", "truncated", "cancelled", "failed"]
    );
    assert.equal(
        snapshot.tables["public.messages"].columns.completion_status.notNull,
        false
    );
    assert.equal(
        snapshot.tables["public.messages"].columns.finish_reason.notNull,
        false
    );
});
