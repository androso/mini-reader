import { eq } from "drizzle-orm";
import { queryController } from "../controllers/QueryControllers";
import { db } from "../db";
import { Books } from "../db/schema";

export async function processInBackground(file:Buffer, bookId: string) {
    try {
        const collection = await queryController.handleProcess(file)
        if(collection.error) {
            console.error(`Error processing collection: ${collection.error}`);
            return;
        }

        await db
            .update(Books)
            .set({collectionName : collection.collectionName})
            .where(eq(Books.id, bookId));

    } catch (error) {
        console.error(`Background processing failed for book ${bookId}:`, error);
    }
}