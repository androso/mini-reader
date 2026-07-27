import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { extractBookMetadata, type BookFileType } from "@reader/processing";
import { createLogger, storageProvider } from "@reader/providers";
import { db, pool } from "./db";
import { Books } from "./db/schema";
import { backfillBookMetadata } from "./services/BookMetadataBackfillService";

const log = createLogger("BookMetadataBackfill");

const main = async () => {
    const result = await backfillBookMetadata({
        listBatch: async (afterId, limit) => {
            const conditions = [
                eq(Books.processingStatus, "ready"),
                isNotNull(Books.fileType),
                isNull(Books.metadataExtractedAt),
            ];
            if (afterId !== null) {
                conditions.push(gt(Books.id, afterId));
            }
            const rows = await db
                .select({
                    id: Books.id,
                    userId: Books.userId,
                    fileKey: Books.fileKey,
                    fileType: Books.fileType,
                })
                .from(Books)
                .where(and(...conditions))
                .orderBy(asc(Books.id))
                .limit(limit);
            return rows.map((row) => ({
                ...row,
                fileType: row.fileType as BookFileType,
            }));
        },
        getFile: (fileKey) => storageProvider.getFile(fileKey),
        extractMetadata: extractBookMetadata,
        markExtracted: async (book, metadata) => {
            const updated = await db
                .update(Books)
                .set({
                    embeddedTitle: metadata.title,
                    creator: metadata.creator,
                    identifier: metadata.identifier,
                    metadataExtractedAt: new Date(),
                    ...(metadata.title === null
                        ? {}
                        : { title: metadata.title }),
                })
                .where(
                    and(
                        eq(Books.id, book.id),
                        eq(Books.userId, book.userId),
                        eq(Books.processingStatus, "ready"),
                        isNull(Books.metadataExtractedAt)
                    )
                )
                .returning({ id: Books.id });
            return updated.length === 1;
        },
        onBookFailure: (bookId, error) => {
            log.error("Book metadata extraction failed", {
                bookId,
                error: error instanceof Error ? error.message : String(error),
            });
        },
    });

    const details = { ...result };
    if (result.failed > 0) {
        log.warn(
            "Book metadata backfill completed with retryable row failures",
            details
        );
    } else {
        log.info("Book metadata backfill complete", details);
    }
};

main()
    .catch((error) => {
        log.error("Book metadata backfill failed", {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
