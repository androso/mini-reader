import { Request, Response, Router } from "express";
import { authenticate } from "../middleware/auth";
import { Books, Progress } from "../db/schema";
import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { asyncHandler } from "../middleware/asyncHandler";

export type TrackerDatabase = Pick<typeof db, "select" | "insert">;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;

const sendBookNotFound = (res: Response): void => {
    res.status(404).json({ message: "Book not found" });
};

export const createTrackerRouter = (database: TrackerDatabase = db) => {
    const router = Router();

    /**
     * @swagger
     * /api/{bookId}/progress:
     *   get:
     *     tags: [Progress]
     *     summary: Get progress for an owned book
     *     parameters:
     *       - in: path
     *         name: bookId
     *         required: true
     *         schema: { type: string, format: uuid }
     *     responses:
     *       200:
     *         description: Saved progress or an empty owned-book state
     *         content:
     *           application/json:
     *             schema: { $ref: '#/components/schemas/Progress' }
     *       404: { description: Book is missing or not owned by this user }
     *       500: { $ref: '#/components/responses/InternalError' }
     */
    router.get(
        "/:rid/progress",
        authenticate,
        asyncHandler(async (req: Request, res: Response) => {
            try {
                const user_id = req.user.id;
                const bookId = req.params.rid;

                if (!isUuid(bookId)) {
                    sendBookNotFound(res);
                    return;
                }

                // First get the book to ensure it exists
                const [book] = await database
                    .select()
                    .from(Books)
                    .where(
                        and(eq(Books.id, bookId), eq(Books.userId, user_id))
                    );

                if (!book) {
                    sendBookNotFound(res);
                    return;
                }

                const [progress] = await database
                    .select()
                    .from(Progress)
                    .where(
                        and(
                            eq(Progress.userId, user_id),
                            eq(Progress.bookId, book.id)
                        )
                    );

                // If no progress exists, return initial state
                if (!progress) {
                    res.status(200).json({
                        progressPosition: null,
                    });
                    return;
                }
                res.status(200).json({
                    progressPosition: progress.progressPosition,
                    progressChapter: progress.progressChapter,
                });
            } catch (error) {
                console.error("Error fetching progress:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        })
    );

    /**
     * @swagger
     * /api/{bookId}/progress:
     *   post:
     *     tags: [Progress]
     *     summary: Atomically save progress for an owned book
     *     parameters:
     *       - in: path
     *         name: bookId
     *         required: true
     *         schema: { type: string, format: uuid }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [progress_block, progress_chapter]
     *             properties:
     *               progress_block: { type: string }
     *               progress_chapter: { type: string }
     *     responses:
     *       201: { description: Progress inserted or updated on userId and bookId }
     *       400: { description: Progress fields are missing }
     *       403: { description: Origin does not match FRONTEND_URL }
     *       404: { description: Book is missing or not owned by this user }
     *       500: { $ref: '#/components/responses/InternalError' }
     */
    router.post(
        "/:rid/progress",
        authenticate,
        asyncHandler(async (req: Request, res: Response) => {
            try {
                const user_id = req.user.id;
                const bookId = req.params.rid;

                if (!isUuid(bookId)) {
                    sendBookNotFound(res);
                    return;
                }

                const { progress_block, progress_chapter } = req.body ?? {};

                if (
                    !isNonEmptyString(progress_block) ||
                    !isNonEmptyString(progress_chapter)
                ) {
                    res.status(400).json({
                        message:
                            "Progress Block and Progress Chapter are required",
                    });
                    return;
                }

                // Resolve the public book identity without exposing its storage key.
                const [book] = await database
                    .select()
                    .from(Books)
                    .where(
                        and(eq(Books.id, bookId), eq(Books.userId, user_id))
                    );

                if (!book) {
                    sendBookNotFound(res);
                    return;
                }

                const [progress] = await database
                    .insert(Progress)
                    .values({
                        userId: user_id,
                        bookId: book.id,
                        progressPosition: progress_block,
                        progressChapter: progress_chapter,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .onConflictDoUpdate({
                        target: [Progress.userId, Progress.bookId],
                        set: {
                            progressPosition: progress_block,
                            progressChapter: progress_chapter,
                            updatedAt: new Date(),
                        },
                    })
                    .returning();
                res.status(201).json({
                    message: "Progress saved",
                    data: progress,
                });
            } catch (error) {
                console.error("Progress can't be tracked", error);
                res.status(500).json({ message: "Progress wasn't saved" });
            }
        })
    );

    return router;
};

export default createTrackerRouter();
