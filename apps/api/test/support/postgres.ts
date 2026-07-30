import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

export const integrationTestDatabaseUrl =
    process.env.INTEGRATION_TEST_DATABASE_URL;

export const integrationTestOptions: { skip: false | string } = {
    skip:
        integrationTestDatabaseUrl || process.env.CI
            ? false
            : "requires INTEGRATION_TEST_DATABASE_URL",
};

const quoteIdentifier = (identifier: string) =>
    `"${identifier.replace(/"/g, '""')}"`;

export const withTestDatabase = async (
    prefix: string,
    options: { migrate: boolean },
    run: (context: { url: string; client: Client }) => Promise<void>
): Promise<void> => {
    assert.ok(integrationTestDatabaseUrl);

    const adminUrl = new URL(integrationTestDatabaseUrl);
    const databaseName = `${prefix}_${randomUUID().replace(/-/g, "")}`;
    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    const url = testUrl.toString();

    const admin = new Client({ connectionString: adminUrl.toString() });
    let databaseCreated = false;
    let client: Client | undefined;

    await admin.connect();
    try {
        await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
        databaseCreated = true;

        client = new Client({ connectionString: url });
        await client.connect();

        if (options.migrate) {
            await migrate(drizzle(client), {
                migrationsFolder: "migrations",
            });
        }

        await run({ url, client });
    } finally {
        if (client) await client.end();
        if (databaseCreated) {
            await admin.query(
                `SELECT pg_terminate_backend("pid") FROM "pg_stat_activity" WHERE "datname" = $1`,
                [databaseName]
            );
            await admin.query(`DROP DATABASE ${quoteIdentifier(databaseName)}`);
        }
        await admin.end();
    }
};
