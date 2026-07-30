import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import jwt from "jsonwebtoken";
import JSZip from "jszip";
import { withHttpServer } from "./support/http";
import { integrationTestOptions, withTestDatabase } from "./support/postgres";

const FRONTEND_ORIGIN = "http://reader.test";

const USER_ID = "10000000-0000-4000-8000-000000000021";
const EPUB_ID = "20000000-0000-4000-8000-000000000021";
const PDF_ID = "20000000-0000-4000-8000-000000000022";
const FAILED_ID = "20000000-0000-4000-8000-000000000023";
const MISSING_ID = "20000000-0000-4000-8000-000000009999";

const makeMinimalEpub = async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
        "EPUB/package.opf",
        `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Route fixture</dc:title><dc:creator>Routes</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="image" href="Images/cover.svg" media-type="image/svg+xml" properties="cover-image"/></manifest><spine><itemref idref="chapter"/></spine></package>`
    );
    zip.file(
        "EPUB/nav.xhtml",
        `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="Text/chapter.xhtml#start">Start</a></li></ol></nav></body></html>`
    );
    zip.file(
        "EPUB/Text/chapter.xhtml",
        `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="start">Start</h1><img src="../Images/cover.svg"/><p>Route chapter text.</p></body></html>`
    );
    zip.file(
        "EPUB/Images/cover.svg",
        `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`
    );
    return zip.generateAsync({ type: "nodebuffer" });
};

test(
    "book reader routes cover manifest states, chapter/resource, and retry",
    integrationTestOptions,
    async () => {
        await withTestDatabase(
            "reader_book_routes",
            { migrate: true },
            async ({ url, client: database }) => {
                const storageDir = await mkdtemp(
                    path.join(tmpdir(), "reader-book-routes-")
                );
                let pool: (typeof import("../src/db"))["pool"] | undefined;

                try {
                    Object.assign(process.env, {
                        NODE_ENV: "test",
                        CODEX_OAUTH_ENABLED: "false",
                        JWT_SECRET: "book-routes-reader-test-secret",
                        GOOGLE_CLIENT_ID:
                            "reader-book-routes.apps.googleusercontent.com",
                        FRONTEND_URL: FRONTEND_ORIGIN,
                        STORAGE_DRIVER: "local",
                        LOCAL_STORAGE_DIR: storageDir,
                        BOOK_PROCESSING_RUNNER_ENABLED: "false",
                        DATABASE_URL: url,
                        OPENAI_API_KEY:
                            process.env.OPENAI_API_KEY ?? "test-openai-key",
                    });

                    const { default: app } = await import("../src/app");
                    const { uploadFile } = await import("@reader/providers");
                    const { generateAndPersistReaderPackage } = await import(
                        "../src/services/ReaderPackageService"
                    );
                    ({ pool } = await import("../src/db"));

                    await database.query(
                        `INSERT INTO "users" ("id", "email", "name", "username") VALUES ($1, 'routes@example.test', 'Routes', 'routes_user')`,
                        [USER_ID]
                    );

                    const epubKey = `users/${USER_ID}/books/${EPUB_ID}/original`;
                    const pdfKey = `users/${USER_ID}/books/${PDF_ID}/original`;
                    const failedKey = `users/${USER_ID}/books/${FAILED_ID}/original`;
                    await uploadFile(epubKey, await makeMinimalEpub());
                    await uploadFile(pdfKey, Buffer.from("%PDF-1.4\n%%EOF\n"));
                    await uploadFile(failedKey, await makeMinimalEpub());

                    await database.query(
                        `
                            INSERT INTO "books" (
                                "id", "title", "user_id", "file_key", "file_type",
                                "original_filename", "processing_status",
                                "reader_package_status", "reader_package_error"
                            ) VALUES ($1, 'EPUB Book', $2, $3, 'epub', 'book.epub', 'ready', 'not_requested', null)
                        `,
                        [EPUB_ID, USER_ID, epubKey]
                    );
                    await database.query(
                        `
                            INSERT INTO "books" (
                                "id", "title", "user_id", "file_key", "file_type",
                                "original_filename", "processing_status",
                                "reader_package_status", "reader_package_error"
                            ) VALUES ($1, 'PDF Book', $2, $3, 'pdf', 'book.pdf', 'ready', 'not_requested', null)
                        `,
                        [PDF_ID, USER_ID, pdfKey]
                    );
                    await database.query(
                        `
                            INSERT INTO "books" (
                                "id", "title", "user_id", "file_key", "file_type",
                                "original_filename", "processing_status",
                                "reader_package_status", "reader_package_error"
                            ) VALUES ($1, 'Failed EPUB', $2, $3, 'epub', 'failed.epub', 'ready', 'failed', 'boom')
                        `,
                        [FAILED_ID, USER_ID, failedKey]
                    );

                    const cookie = `reader_session=${jwt.sign(
                        { userId: USER_ID },
                        process.env.JWT_SECRET!
                    )}`;

                    await withHttpServer(app, async (baseUrl) => {
                        const notFound = await fetch(
                            `${baseUrl}/api/books/${MISSING_ID}/reader-manifest`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(notFound.status, 404);
                        assert.deepEqual(await notFound.json(), {
                            error: "Book was not found",
                        });

                        const unsupported = await fetch(
                            `${baseUrl}/api/books/${PDF_ID}/reader-manifest`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(unsupported.status, 409);
                        assert.deepEqual(await unsupported.json(), {
                            error: "Reader packages are available only for EPUB books",
                        });

                        const processing = await fetch(
                            `${baseUrl}/api/books/${EPUB_ID}/reader-manifest`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(processing.status, 202);
                        assert.deepEqual(await processing.json(), {
                            status: "processing",
                        });

                        const failed = await fetch(
                            `${baseUrl}/api/books/${FAILED_ID}/reader-manifest`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(failed.status, 409);
                        assert.deepEqual(await failed.json(), {
                            status: "failed",
                            error: "boom",
                            retryable: true,
                        });

                        const missingChapter = await fetch(
                            `${baseUrl}/api/books/${EPUB_ID}/reader-chapters/missing`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(missingChapter.status, 404);

                        const missingResource = await fetch(
                            `${baseUrl}/api/books/${EPUB_ID}/reader-resources/missing`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(missingResource.status, 404);

                        const retryMissing = await fetch(
                            `${baseUrl}/api/books/${MISSING_ID}/reader-package/retry`,
                            {
                                method: "POST",
                                headers: {
                                    Cookie: cookie,
                                    Origin: FRONTEND_ORIGIN,
                                },
                            }
                        );
                        assert.equal(retryMissing.status, 404);

                        const retryFailed = await fetch(
                            `${baseUrl}/api/books/${FAILED_ID}/reader-package/retry`,
                            {
                                method: "POST",
                                headers: {
                                    Cookie: cookie,
                                    Origin: FRONTEND_ORIGIN,
                                },
                            }
                        );
                        assert.equal(retryFailed.status, 202);
                        assert.deepEqual(await retryFailed.json(), {
                            status: "processing",
                        });

                        const cover = await fetch(
                            `${baseUrl}/api/books/${EPUB_ID}/cover`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(cover.status, 200);
                        assert.equal(
                            cover.headers.get("content-type"),
                            "image/svg+xml"
                        );
                        assert.ok(
                            Buffer.from(await cover.arrayBuffer()).byteLength >
                                0
                        );

                        const pdfCover = await fetch(
                            `${baseUrl}/api/books/${PDF_ID}/cover`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(pdfCover.status, 404);

                        await generateAndPersistReaderPackage(EPUB_ID, USER_ID);

                        const ready = await fetch(
                            `${baseUrl}/api/books/${EPUB_ID}/reader-manifest`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(ready.status, 200);
                        const manifest = (await ready.json()) as {
                            chapters: Array<{ id: string }>;
                            resources: Array<{ id: string }>;
                            coverResourceId: string | null;
                            status: string;
                        };
                        assert.equal(manifest.status, "ready");
                        assert.ok(manifest.chapters.length > 0);
                        assert.ok(manifest.resources.length > 0);

                        const chapter = await fetch(
                            `${baseUrl}/api/books/${EPUB_ID}/reader-chapters/${manifest.chapters[0]!.id}`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(chapter.status, 200);
                        const chapterBody = (await chapter.json()) as {
                            bookId: string;
                            blocks: unknown[];
                        };
                        assert.equal(chapterBody.bookId, EPUB_ID);
                        assert.ok(chapterBody.blocks.length > 0);

                        const resourceId =
                            manifest.coverResourceId ??
                            manifest.resources[0]!.id;
                        const resource = await fetch(
                            `${baseUrl}/api/books/${EPUB_ID}/reader-resources/${resourceId}`,
                            { headers: { Cookie: cookie } }
                        );
                        assert.equal(resource.status, 200);
                        assert.ok(
                            (resource.headers.get("content-type") ?? "")
                                .length > 0
                        );
                        const bytes = Buffer.from(await resource.arrayBuffer());
                        assert.ok(bytes.byteLength > 0);
                    });
                } finally {
                    if (pool) await pool.end();
                    await rm(storageDir, { recursive: true, force: true });
                }
            }
        );
    }
);
