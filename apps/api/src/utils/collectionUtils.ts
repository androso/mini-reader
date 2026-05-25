import { eq } from "drizzle-orm";
import { queryController } from "../controllers/QueryControllers";
import { db } from "../db";
import { Books } from "../db/schema";
import { PDFService } from "../services/PDFProcessor";

const getProcessingErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Document processing failed";

export async function processEpub(file: Buffer, bookId: string) {
    try {
        const collection = await queryController.handleProcess(file);
        if (collection.error) {
            console.error(`Error processing collection: ${collection.error}`);
            await db
                .update(Books)
                .set({
                    processingStatus: "failed",
                    processingError: collection.error,
                })
                .where(eq(Books.id, bookId));
            return;
        }

        await db
            .update(Books)
            .set({
                collectionName: collection.collectionName,
                processingStatus: "ready",
                processingError: null,
            })
            .where(eq(Books.id, bookId));
    } catch (error) {
        console.error(
            `Background processing failed for book ${bookId}:`,
            error
        );
        await db
            .update(Books)
            .set({
                processingStatus: "failed",
                processingError: getProcessingErrorMessage(error),
            })
            .where(eq(Books.id, bookId));
    }
}
export async function processPDF(file: Buffer, bookId: string) {
    try {
        const collection = await new PDFService().processPDF(file);
        await db
            .update(Books)
            .set({
                collectionName: collection.collection,
                processingStatus: "ready",
                processingError: null,
            })
            .where(eq(Books.id, bookId));
    } catch (error) {
        console.error(
            `Background processing failed for book ${bookId}:`,
            error
        );
        await db
            .update(Books)
            .set({
                processingStatus: "failed",
                processingError: getProcessingErrorMessage(error),
            })
            .where(eq(Books.id, bookId));
    }
}
