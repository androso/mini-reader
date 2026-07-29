import { buildReaderPackage } from "@reader/epub/dist/server";
import { deleteFile, getFile, uploadFile } from "@reader/providers";
import { and, asc, eq } from "drizzle-orm";
import { db, pool } from "../db";
import {
    Books,
    ReaderChapters,
    ReaderPackageJobs,
    ReaderResources,
} from "../db/schema";

const storageKeyFor = (userId: string, bookId: string, resourceId: string) =>
    `users/${userId}/books/${bookId}/reader/${resourceId}`;

export const enqueueReaderPackage = async (
    bookId: string,
    userId: string,
    resetFailed = false
) => {
    const [book] = await db
        .select({ id: Books.id, fileType: Books.fileType })
        .from(Books)
        .where(and(eq(Books.id, bookId), eq(Books.userId, userId)));
    if (!book || book.fileType !== "epub") return false;

    await db
        .insert(ReaderPackageJobs)
        .values({
            id: `reader-package:${bookId}`,
            bookId,
            userId,
            status: "queued",
        })
        .onConflictDoUpdate({
            target: ReaderPackageJobs.bookId,
            set: {
                status: "queued",
                attempts: resetFailed ? 0 : ReaderPackageJobs.attempts,
                lastError: null,
                availableAt: new Date(),
                lockedAt: null,
                completedAt: null,
                updatedAt: new Date(),
            },
        });
    await db
        .update(Books)
        .set({
            readerPackageStatus: "processing",
            readerPackageError: null,
        })
        .where(and(eq(Books.id, bookId), eq(Books.userId, userId)));
    return true;
};

export const generateAndPersistReaderPackage = async (
    bookId: string,
    userId: string
) => {
    const [book] = await db
        .select()
        .from(Books)
        .where(and(eq(Books.id, bookId), eq(Books.userId, userId)));
    if (!book || book.fileType !== "epub") {
        throw new Error("Owned EPUB was not found");
    }

    const readerPackage = await buildReaderPackage(await getFile(book.fileKey));
    if (readerPackage.chapters.length === 0) {
        throw new Error("EPUB reader package contains no readable chapters");
    }

    const uploadedKeys: string[] = [];
    try {
        for (const resource of readerPackage.resources) {
            const storageKey = storageKeyFor(userId, bookId, resource.id);
            await uploadFile(storageKey, Buffer.from(resource.bytes));
            uploadedKeys.push(storageKey);
        }

        await db.transaction(async (tx) => {
            await tx
                .delete(ReaderChapters)
                .where(eq(ReaderChapters.bookId, bookId));
            await tx
                .delete(ReaderResources)
                .where(eq(ReaderResources.bookId, bookId));
            await tx.insert(ReaderChapters).values(
                readerPackage.chapters.map((chapter) => ({
                    bookId,
                    id: chapter.id,
                    title: chapter.title,
                    href: chapter.href,
                    chapterOrder: chapter.order,
                    blocks: chapter.blocks,
                }))
            );
            if (readerPackage.resources.length > 0) {
                await tx.insert(ReaderResources).values(
                    readerPackage.resources.map((resource) => ({
                        bookId,
                        id: resource.id,
                        storageKey: storageKeyFor(userId, bookId, resource.id),
                        mediaType: resource.mediaType,
                        size: resource.bytes.byteLength,
                        isCover: resource.isCover,
                    }))
                );
            }
            await tx
                .update(Books)
                .set({
                    readerPackageStatus: "ready",
                    readerPackageError: null,
                    readerPackageGeneratedAt: new Date(),
                    readerPackageToc: readerPackage.toc,
                })
                .where(and(eq(Books.id, bookId), eq(Books.userId, userId)));
        });
    } catch (error) {
        await Promise.allSettled(uploadedKeys.map((key) => deleteFile(key)));
        throw error;
    }
};

export const getOwnedReaderManifest = async (
    bookId: string,
    userId: string
) => {
    const [book] = await db
        .select()
        .from(Books)
        .where(and(eq(Books.id, bookId), eq(Books.userId, userId)));
    if (!book) return { kind: "not_found" as const };
    if (book.fileType !== "epub") return { kind: "unsupported" as const };
    if (
        book.readerPackageStatus === "not_requested" ||
        !book.readerPackageStatus
    ) {
        await enqueueReaderPackage(bookId, userId);
        return { kind: "processing" as const };
    }
    if (book.readerPackageStatus === "processing") {
        return { kind: "processing" as const };
    }
    if (book.readerPackageStatus === "failed") {
        return {
            kind: "failed" as const,
            error: book.readerPackageError,
        };
    }

    const chapters = await db
        .select()
        .from(ReaderChapters)
        .where(eq(ReaderChapters.bookId, bookId))
        .orderBy(asc(ReaderChapters.chapterOrder));
    const resources = await db
        .select({
            id: ReaderResources.id,
            mediaType: ReaderResources.mediaType,
            size: ReaderResources.size,
            isCover: ReaderResources.isCover,
        })
        .from(ReaderResources)
        .where(eq(ReaderResources.bookId, bookId));
    return {
        kind: "ready" as const,
        manifest: {
            bookId,
            title: book.title,
            creator: book.creator,
            status: "ready" as const,
            chapters: chapters.map((chapter) => ({
                id: chapter.id,
                title: chapter.title,
                href: chapter.href,
                order: chapter.chapterOrder,
                firstBlockId: chapter.blocks[0]?.id ?? null,
            })),
            toc:
                book.readerPackageToc ??
                chapters.map((chapter) => ({
                    title:
                        chapter.title ?? `Chapter ${chapter.chapterOrder + 1}`,
                    level: 0,
                    chapterId: chapter.id,
                    blockId: chapter.blocks[0]?.id ?? null,
                })),
            resources: resources.map(
                ({ isCover: _isCover, ...resource }) => resource
            ),
            coverResourceId:
                resources.find((resource) => resource.isCover)?.id ?? null,
            generatedAt:
                book.readerPackageGeneratedAt?.toISOString() ??
                new Date(0).toISOString(),
        },
    };
};

export const getOwnedReaderChapter = async (
    bookId: string,
    chapterId: string,
    userId: string
) => {
    const [chapter] = await db
        .select({
            id: ReaderChapters.id,
            title: ReaderChapters.title,
            href: ReaderChapters.href,
            order: ReaderChapters.chapterOrder,
            blocks: ReaderChapters.blocks,
        })
        .from(ReaderChapters)
        .innerJoin(Books, and(eq(Books.id, bookId), eq(Books.userId, userId)))
        .where(
            and(
                eq(ReaderChapters.bookId, bookId),
                eq(ReaderChapters.id, chapterId)
            )
        );
    return chapter ? { bookId, ...chapter } : null;
};

export const getOwnedReaderResource = async (
    bookId: string,
    resourceId: string,
    userId: string
) => {
    const [resource] = await db
        .select({
            storageKey: ReaderResources.storageKey,
            mediaType: ReaderResources.mediaType,
        })
        .from(ReaderResources)
        .innerJoin(Books, and(eq(Books.id, bookId), eq(Books.userId, userId)))
        .where(
            and(
                eq(ReaderResources.bookId, bookId),
                eq(ReaderResources.id, resourceId)
            )
        );
    if (!resource) return null;
    return {
        mediaType: resource.mediaType,
        bytes: await getFile(resource.storageKey),
    };
};

type ClaimedReaderPackageJob = {
    id: string;
    bookId: string;
    userId: string;
    attempts: number;
    maxAttempts: number;
};

const claimReaderPackageJob =
    async (): Promise<ClaimedReaderPackageJob | null> => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query<{
                id: string;
                book_id: string;
                user_id: string;
                attempts: number;
                max_attempts: number;
            }>(
                `SELECT id, book_id, user_id, attempts, max_attempts
                 FROM reader_package_jobs
                 WHERE status IN ('queued', 'retrying') AND available_at <= now()
                 ORDER BY available_at ASC, created_at ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`
            );
            const row = result.rows[0];
            if (!row) {
                await client.query("COMMIT");
                return null;
            }
            const attempts = row.attempts + 1;
            await client.query(
                `UPDATE reader_package_jobs
                 SET status = 'processing', attempts = $2, locked_at = now(), updated_at = now()
                 WHERE id = $1`,
                [row.id, attempts]
            );
            await client.query("COMMIT");
            return {
                id: row.id,
                bookId: row.book_id,
                userId: row.user_id,
                attempts,
                maxAttempts: row.max_attempts,
            };
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    };

export const processNextReaderPackageJob = async () => {
    await pool.query(
        `UPDATE reader_package_jobs
         SET status = 'retrying', locked_at = null, available_at = now(), updated_at = now(),
             last_error = COALESCE(last_error, 'Recovered stale reader-package job')
         WHERE status = 'processing' AND locked_at < now() - interval '30 minutes'`
    );
    const job = await claimReaderPackageJob();
    if (!job) return false;
    try {
        await generateAndPersistReaderPackage(job.bookId, job.userId);
        await pool.query(
            `UPDATE reader_package_jobs
             SET status = 'completed', completed_at = now(), locked_at = null, last_error = null, updated_at = now()
             WHERE id = $1`,
            [job.id]
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Reader package failed";
        const failed = job.attempts >= job.maxAttempts;
        const delaySeconds = Math.ceil(5 * 2 ** Math.max(job.attempts - 1, 0));
        await pool.query(
            `UPDATE reader_package_jobs
             SET status = $2, last_error = $3,
                 available_at = CASE WHEN $2 = 'retrying' THEN now() + ($4 * interval '1 second') ELSE available_at END,
                 locked_at = null, updated_at = now()
             WHERE id = $1`,
            [job.id, failed ? "failed" : "retrying", message, delaySeconds]
        );
        await pool.query(
            `UPDATE books
             SET reader_package_status = $2, reader_package_error = $3
             WHERE id = $1`,
            [job.bookId, failed ? "failed" : "processing", message]
        );
    }
    return true;
};
