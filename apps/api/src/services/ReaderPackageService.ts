import { buildReaderPackage } from "@reader/epub/dist/server";
import { deleteFile, getFile, uploadFile } from "@reader/providers";
import { and, asc, eq } from "drizzle-orm";
import { db, pool } from "../db";
import {
    Books,
    ReaderChapters,
    ReaderPackageJobs,
    ReaderResources,
    type ReaderChapterBlock,
    type ReaderPackageTocEntry,
} from "../db/schema";

const storageKeyFor = (userId: string, bookId: string, resourceId: string) =>
    `users/${userId}/books/${bookId}/reader/${resourceId}`;

export type OwnedReaderBook = {
    id: string;
    title: string;
    creator: string | null;
    fileType: string | null;
    readerPackageStatus: string | null;
    readerPackageError: string | null;
    readerPackageGeneratedAt: Date | null;
    readerPackageToc: ReaderPackageTocEntry[] | null;
};

export type ReaderPackageChapterRow = {
    id: string;
    title: string | null;
    href: string;
    chapterOrder: number;
    blocks: ReaderChapterBlock[];
};

export type ReaderPackageResourceRow = {
    id: string;
    mediaType: string;
    size: number;
    isCover: boolean;
};

export interface ReaderPackageRepository {
    findOwnedBook(
        bookId: string,
        userId: string
    ): Promise<OwnedReaderBook | null>;
    findOwnedBookForEnqueue(
        bookId: string,
        userId: string
    ): Promise<{ id: string; fileType: string | null } | null>;
    enqueueJob(
        bookId: string,
        userId: string,
        resetFailed: boolean
    ): Promise<void>;
    markBookProcessing(bookId: string, userId: string): Promise<void>;
    listChapters(bookId: string): Promise<ReaderPackageChapterRow[]>;
    listResources(bookId: string): Promise<ReaderPackageResourceRow[]>;
    findOwnedChapter(
        bookId: string,
        chapterId: string,
        userId: string
    ): Promise<
        | (Omit<ReaderPackageChapterRow, "chapterOrder"> & { order: number })
        | null
    >;
    findOwnedResource(
        bookId: string,
        resourceId: string,
        userId: string
    ): Promise<{ storageKey: string; mediaType: string } | null>;
}

export type ReaderPackageBuildResult = Awaited<
    ReturnType<typeof buildReaderPackage>
>;

export type ReaderPackageDependencies = {
    repository: ReaderPackageRepository;
    getFile: (key: string) => Promise<Buffer>;
    uploadFile?: (key: string, file: Buffer) => Promise<unknown>;
    deleteFile?: (key: string) => Promise<unknown>;
    buildReaderPackage?: (buffer: Buffer) => Promise<ReaderPackageBuildResult>;
    findOwnedBookRow?: (
        bookId: string,
        userId: string
    ) => Promise<{
        id: string;
        userId: string;
        fileKey: string;
        fileType: string | null;
    } | null>;
    persistGeneratedPackage?: (input: {
        bookId: string;
        userId: string;
        readerPackage: ReaderPackageBuildResult;
        storageKeyFor: (
            userId: string,
            bookId: string,
            resourceId: string
        ) => string;
    }) => Promise<void>;
    pool?: Pick<typeof pool, "connect" | "query">;
    generateAndPersistReaderPackage?: (
        bookId: string,
        userId: string
    ) => Promise<void>;
};

export const readerPackageRepository: ReaderPackageRepository = {
    async findOwnedBook(bookId, userId) {
        const [book] = await db
            .select({
                id: Books.id,
                title: Books.title,
                creator: Books.creator,
                fileType: Books.fileType,
                readerPackageStatus: Books.readerPackageStatus,
                readerPackageError: Books.readerPackageError,
                readerPackageGeneratedAt: Books.readerPackageGeneratedAt,
                readerPackageToc: Books.readerPackageToc,
            })
            .from(Books)
            .where(and(eq(Books.id, bookId), eq(Books.userId, userId)));
        return book ?? null;
    },

    async findOwnedBookForEnqueue(bookId, userId) {
        const [book] = await db
            .select({ id: Books.id, fileType: Books.fileType })
            .from(Books)
            .where(and(eq(Books.id, bookId), eq(Books.userId, userId)));
        return book ?? null;
    },

    async enqueueJob(bookId, userId, resetFailed) {
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
    },

    async markBookProcessing(bookId, userId) {
        await db
            .update(Books)
            .set({
                readerPackageStatus: "processing",
                readerPackageError: null,
            })
            .where(and(eq(Books.id, bookId), eq(Books.userId, userId)));
    },

    async listChapters(bookId) {
        return db
            .select({
                id: ReaderChapters.id,
                title: ReaderChapters.title,
                href: ReaderChapters.href,
                chapterOrder: ReaderChapters.chapterOrder,
                blocks: ReaderChapters.blocks,
            })
            .from(ReaderChapters)
            .where(eq(ReaderChapters.bookId, bookId))
            .orderBy(asc(ReaderChapters.chapterOrder));
    },

    async listResources(bookId) {
        return db
            .select({
                id: ReaderResources.id,
                mediaType: ReaderResources.mediaType,
                size: ReaderResources.size,
                isCover: ReaderResources.isCover,
            })
            .from(ReaderResources)
            .where(eq(ReaderResources.bookId, bookId));
    },

    async findOwnedChapter(bookId, chapterId, userId) {
        const [chapter] = await db
            .select({
                id: ReaderChapters.id,
                title: ReaderChapters.title,
                href: ReaderChapters.href,
                order: ReaderChapters.chapterOrder,
                blocks: ReaderChapters.blocks,
            })
            .from(ReaderChapters)
            .innerJoin(
                Books,
                and(eq(Books.id, bookId), eq(Books.userId, userId))
            )
            .where(
                and(
                    eq(ReaderChapters.bookId, bookId),
                    eq(ReaderChapters.id, chapterId)
                )
            );
        return chapter ?? null;
    },

    async findOwnedResource(bookId, resourceId, userId) {
        const [resource] = await db
            .select({
                storageKey: ReaderResources.storageKey,
                mediaType: ReaderResources.mediaType,
            })
            .from(ReaderResources)
            .innerJoin(
                Books,
                and(eq(Books.id, bookId), eq(Books.userId, userId))
            )
            .where(
                and(
                    eq(ReaderResources.bookId, bookId),
                    eq(ReaderResources.id, resourceId)
                )
            );
        return resource ?? null;
    },
};

export const defaultReaderPackageDependencies: ReaderPackageDependencies = {
    repository: readerPackageRepository,
    getFile,
    uploadFile,
    deleteFile,
    buildReaderPackage,
    pool,
};

export const enqueueReaderPackage = async (
    bookId: string,
    userId: string,
    resetFailed = false,
    dependencies: Pick<
        ReaderPackageDependencies,
        "repository"
    > = defaultReaderPackageDependencies
) => {
    const book = await dependencies.repository.findOwnedBookForEnqueue(
        bookId,
        userId
    );
    if (!book || book.fileType !== "epub") return false;

    await dependencies.repository.enqueueJob(bookId, userId, resetFailed);
    await dependencies.repository.markBookProcessing(bookId, userId);
    return true;
};

export const generateAndPersistReaderPackage = async (
    bookId: string,
    userId: string,
    dependencies: ReaderPackageDependencies = defaultReaderPackageDependencies
) => {
    const book = dependencies.findOwnedBookRow
        ? await dependencies.findOwnedBookRow(bookId, userId)
        : ((
              await db
                  .select()
                  .from(Books)
                  .where(and(eq(Books.id, bookId), eq(Books.userId, userId)))
          )[0] ?? null);
    if (!book || book.fileType !== "epub") {
        throw new Error("Owned EPUB was not found");
    }

    const readFile = dependencies.getFile;
    const buildPackage = dependencies.buildReaderPackage ?? buildReaderPackage;
    const upload = dependencies.uploadFile ?? uploadFile;
    const remove = dependencies.deleteFile ?? deleteFile;

    const readerPackage = await buildPackage(await readFile(book.fileKey));
    if (readerPackage.chapters.length === 0) {
        throw new Error("EPUB reader package contains no readable chapters");
    }

    const uploadedKeys: string[] = [];
    try {
        for (const resource of readerPackage.resources) {
            const storageKey = storageKeyFor(userId, bookId, resource.id);
            await upload(storageKey, Buffer.from(resource.bytes));
            uploadedKeys.push(storageKey);
        }

        if (dependencies.persistGeneratedPackage) {
            await dependencies.persistGeneratedPackage({
                bookId,
                userId,
                readerPackage,
                storageKeyFor,
            });
            return;
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
        await Promise.allSettled(uploadedKeys.map((key) => remove(key)));
        throw error;
    }
};

export const getOwnedReaderManifest = async (
    bookId: string,
    userId: string,
    dependencies: ReaderPackageDependencies = defaultReaderPackageDependencies
) => {
    const book = await dependencies.repository.findOwnedBook(bookId, userId);
    if (!book) return { kind: "not_found" as const };
    if (book.fileType !== "epub") return { kind: "unsupported" as const };
    if (
        book.readerPackageStatus === "not_requested" ||
        !book.readerPackageStatus
    ) {
        await enqueueReaderPackage(bookId, userId, false, dependencies);
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

    const chapters = await dependencies.repository.listChapters(bookId);
    const resources = await dependencies.repository.listResources(bookId);
    const coverResource =
        resources.find((resource) => resource.isCover) ??
        resources.find((resource) =>
            resource.mediaType.toLowerCase().startsWith("image/")
        );
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
            coverResourceId: coverResource?.id ?? null,
            generatedAt:
                book.readerPackageGeneratedAt?.toISOString() ??
                new Date(0).toISOString(),
        },
    };
};

export const getOwnedReaderChapter = async (
    bookId: string,
    chapterId: string,
    userId: string,
    dependencies: Pick<
        ReaderPackageDependencies,
        "repository"
    > = defaultReaderPackageDependencies
) => {
    const chapter = await dependencies.repository.findOwnedChapter(
        bookId,
        chapterId,
        userId
    );
    return chapter ? { bookId, ...chapter } : null;
};

export const getOwnedReaderResource = async (
    bookId: string,
    resourceId: string,
    userId: string,
    dependencies: ReaderPackageDependencies = defaultReaderPackageDependencies
) => {
    const resource = await dependencies.repository.findOwnedResource(
        bookId,
        resourceId,
        userId
    );
    if (!resource) return null;
    return {
        mediaType: resource.mediaType,
        bytes: await dependencies.getFile(resource.storageKey),
    };
};

type ClaimedReaderPackageJob = {
    id: string;
    bookId: string;
    userId: string;
    attempts: number;
    maxAttempts: number;
};

const claimReaderPackageJob = async (
    jobPool: Pick<typeof pool, "connect" | "query"> = pool
): Promise<ClaimedReaderPackageJob | null> => {
    const client = await jobPool.connect();
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

export const processNextReaderPackageJob = async (
    dependencies: ReaderPackageDependencies = defaultReaderPackageDependencies
) => {
    const jobPool = dependencies.pool ?? pool;
    await jobPool.query(
        `UPDATE reader_package_jobs
         SET status = 'retrying', locked_at = null, available_at = now(), updated_at = now(),
             last_error = COALESCE(last_error, 'Recovered stale reader-package job')
         WHERE status = 'processing' AND locked_at < now() - interval '30 minutes'`
    );
    const job = await claimReaderPackageJob(jobPool);
    if (!job) return false;
    const generate =
        dependencies.generateAndPersistReaderPackage ??
        generateAndPersistReaderPackage;
    try {
        await generate(job.bookId, job.userId);
        await jobPool.query(
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
        await jobPool.query(
            `UPDATE reader_package_jobs
             SET status = $2::reader_package_job_status,
                 last_error = $3,
                 available_at = CASE
                     WHEN $2::reader_package_job_status = 'retrying'
                     THEN now() + ($4::double precision * interval '1 second')
                     ELSE available_at
                 END,
                 locked_at = null,
                 updated_at = now()
             WHERE id = $1`,
            [job.id, failed ? "failed" : "retrying", message, delaySeconds]
        );
        await jobPool.query(
            `UPDATE books
             SET reader_package_status = $2::text, reader_package_error = $3
             WHERE id = $1`,
            [job.bookId, failed ? "failed" : "processing", message]
        );
    }
    return true;
};
