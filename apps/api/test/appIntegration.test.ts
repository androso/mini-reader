import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { firstSessionCookie, withHttpServer } from "./support/http";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";

const FRONTEND_ORIGIN = "http://reader.test";

const storageHasFiles = async (root: string): Promise<boolean> => {
    const entries = await readdir(root, {
        withFileTypes: true,
        recursive: true,
    });
    return entries.some((entry) => entry.isFile());
};

const signup = async (
    baseUrl: string,
    account: { username: string; email: string; password: string }
) => {
    const response = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Origin: FRONTEND_ORIGIN,
        },
        body: JSON.stringify(account),
    });
    const text = await response.text();
    assert.equal(response.status, 201, text);
    const body = JSON.parse(text) as { user: Record<string, unknown> };
    return {
        cookie: firstSessionCookie(response),
        user: body.user,
    };
};

test(
    "app HTTP integration covers auth projection, CSRF upload gating, owner acceptance, and non-owner 404",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_app",
            { migrate: true },
            async ({ url, client: database }) => {
                const storageDir = await mkdtemp(
                    path.join(tmpdir(), "reader-app-integration-")
                );
                let pool: (typeof import("../src/db"))["pool"] | undefined;

                try {
                    // Env must be set before dynamically importing app: db Pool,
                    // storageProvider, JWT_SECRET, and Codex validation all read
                    // process.env at module load. dotenv.config() will not override
                    // these once set. Skip gate: INTEGRATION_TEST_DATABASE_URL or CI.
                    Object.assign(process.env, {
                        NODE_ENV: "test",
                        CODEX_OAUTH_ENABLED: "false",
                        JWT_SECRET: "app-integration-test-jwt-secret-value",
                        GOOGLE_CLIENT_ID:
                            "reader-app-integration.apps.googleusercontent.com",
                        FRONTEND_URL: FRONTEND_ORIGIN,
                        STORAGE_DRIVER: "local",
                        LOCAL_STORAGE_DIR: storageDir,
                        BOOK_PROCESSING_RUNNER_ENABLED: "false",
                        OPENAI_API_KEY: "app-integration-test-openai-key",
                        DATABASE_URL: url,
                    });

                    const { default: app } = await import("../src/app");
                    ({ pool } = await import("../src/db"));

                    await withHttpServer(app, async (baseUrl) => {
                        const owner = await signup(baseUrl, {
                            username: "owner_user",
                            email: "owner@reader.test",
                            password: "password123",
                        });
                        const nonOwner = await signup(baseUrl, {
                            username: "other_user",
                            email: "other@reader.test",
                            password: "password123",
                        });

                        const me = await fetch(`${baseUrl}/api/user`, {
                            headers: { Cookie: owner.cookie },
                        });
                        assert.equal(me.status, 200);
                        const meBody = (await me.json()) as {
                            user: Record<string, unknown>;
                        };
                        assert.equal(meBody.user.email, "owner@reader.test");
                        assert.equal(meBody.user.username, "owner_user");
                        assert.equal("passwordHash" in meBody.user, false);
                        assert.equal("googleId" in meBody.user, false);

                        const pdfBytes = Buffer.from(
                            "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\nstartxref\n0\n%%EOF\n"
                        );

                        for (const origin of [
                            undefined,
                            "https://attacker.example",
                        ]) {
                            const rejectedForm = new FormData();
                            rejectedForm.append(
                                "file",
                                new Blob([pdfBytes], {
                                    type: "application/pdf",
                                }),
                                "rejected.pdf"
                            );
                            const headers: Record<string, string> = {
                                Cookie: owner.cookie,
                            };
                            if (origin) headers.Origin = origin;

                            const rejected = await fetch(
                                `${baseUrl}/api/books`,
                                {
                                    method: "POST",
                                    headers,
                                    body: rejectedForm,
                                }
                            );
                            assert.equal(rejected.status, 403, String(origin));
                            assert.deepEqual(await rejected.json(), {
                                message: "Untrusted request origin",
                            });
                        }

                        const booksBefore = await database.query<{
                            count: string;
                        }>(`SELECT count(*)::text AS count FROM "books"`);
                        assert.equal(booksBefore.rows[0]?.count, "0");
                        assert.equal(await storageHasFiles(storageDir), false);

                        const acceptedForm = new FormData();
                        acceptedForm.append(
                            "file",
                            new Blob([pdfBytes], { type: "application/pdf" }),
                            "tiny.pdf"
                        );
                        const accepted = await fetch(`${baseUrl}/api/books`, {
                            method: "POST",
                            headers: {
                                Cookie: owner.cookie,
                                Origin: FRONTEND_ORIGIN,
                            },
                            body: acceptedForm,
                        });
                        const acceptedText = await accepted.text();
                        assert.equal(accepted.status, 202, acceptedText);
                        const acceptedBody = JSON.parse(acceptedText) as {
                            message: string;
                            processStatus: string;
                            fileType: string;
                            book: Record<string, unknown>;
                        };
                        assert.equal(
                            acceptedBody.message,
                            "File upload accepted for processing"
                        );
                        assert.equal(acceptedBody.processStatus, "processing");
                        assert.equal(acceptedBody.fileType, "application/pdf");
                        assert.equal(typeof acceptedBody.book.id, "string");
                        assert.equal(acceptedBody.book.fileType, "pdf");
                        assert.equal(
                            acceptedBody.book.processingStatus,
                            "processing"
                        );
                        assert.equal("fileKey" in acceptedBody.book, false);
                        assert.equal(
                            "collectionName" in acceptedBody.book,
                            false
                        );
                        assert.equal("fileKey" in acceptedBody, false);
                        assert.equal("collectionName" in acceptedBody, false);

                        const bookId = acceptedBody.book.id as string;
                        const booksAfter = await database.query<{
                            count: string;
                        }>(`SELECT count(*)::text AS count FROM "books"`);
                        assert.equal(booksAfter.rows[0]?.count, "1");
                        assert.equal(await storageHasFiles(storageDir), true);

                        const foreignManifest = await fetch(
                            `${baseUrl}/api/books/${bookId}/reader-manifest`,
                            {
                                headers: { Cookie: nonOwner.cookie },
                            }
                        );
                        assert.equal(foreignManifest.status, 404);
                        assert.deepEqual(await foreignManifest.json(), {
                            error: "Book was not found",
                        });

                        const foreignList = await fetch(
                            `${baseUrl}/api/books`,
                            {
                                headers: { Cookie: nonOwner.cookie },
                            }
                        );
                        assert.equal(foreignList.status, 200);
                        const foreignListBody = (await foreignList.json()) as {
                            books: Array<{ id: string }>;
                        };
                        assert.deepEqual(foreignListBody.books, []);
                    });
                } finally {
                    if (pool) await pool.end();
                    await rm(storageDir, { recursive: true, force: true });
                }
            }
        );
    }
);
