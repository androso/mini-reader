import { and, eq, ne } from "drizzle-orm";
import { db } from "../../api/src/db";
import { Books } from "../../api/src/db/schema";
import type { BookProcessingRepository } from "./jobHandler";

export const bookProcessingRepository: BookProcessingRepository = {
    async findBookForProcessing(bookId, userId) {
        const [book] = await db
            .select()
            .from(Books)
            .where(and(eq(Books.id, bookId), eq(Books.userId, userId)));
        return book ?? null;
    },

    async findReadyDuplicate(fileKey, excludeBookId) {
        const [book] = await db
            .select({ collectionName: Books.collectionName })
            .from(Books)
            .where(
                and(
                    eq(Books.fileKey, fileKey),
                    ne(Books.id, excludeBookId),
                    eq(Books.processingStatus, "ready")
                )
            );

        return book?.collectionName ? book : null;
    },

    async markReady(bookId, collectionName) {
        await db
            .update(Books)
            .set({
                collectionName,
                processingStatus: "ready",
                processingError: null,
            })
            .where(eq(Books.id, bookId));
    },

    async markFailed(bookId, error) {
        await db
            .update(Books)
            .set({
                processingStatus: "failed",
                processingError: error,
            })
            .where(eq(Books.id, bookId));
    },
};
