import { Router } from "express";
const router = Router();
import multer from "multer";
import {
    createLogger,
    deleteFile,
    getFile,
    uploadFile,
} from "@reader/providers";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { db } from "../db";
import { Books } from "../db/schema";
import { eq } from "drizzle-orm";
import {
    BookProcessingQueueUnavailableError,
    handleBookProcessingEnqueue,
} from "../services/BookProcessingEnqueueService";
import { handleBookFileDelivery } from "../services/BookFileDelivery";
import { publicBookSelection, toPublicBook } from "../services/PublicBook";
import { persistUploadedBook } from "../services/BookUploadService";
import {
    acceptBookUpload,
    BookUploadEnqueueError,
    BookUploadValidationError,
} from "../services/BookUploadAcceptanceService";
import {
    BookProcessingRetryConflictError,
    BookProcessingRetryNotFoundError,
    retryBookProcessing,
} from "../services/BookProcessingRetryService";
import {
    BookDeletionForbiddenError,
    BookDeletionNotFoundError,
    deleteOwnedBook,
} from "../services/BookDeletionService";
import { uploadRateLimit } from "../middleware/rateLimit";

const log = createLogger("books");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 80 * 1024 * 1024, // 80 mb
    },
});

/**
 * @swagger
 * /api/books:
 *   post:
 *     tags: [Books]
 *     summary: Validate and queue a book upload
 *     description: Validates PDF or EPUB contents before storage. The compressed request limit is 80 MiB; EPUBs also enforce CRC, safe paths, 5,000 entries, 500 MiB expanded total, 50 MiB per entry, and a 100:1 expansion ratio.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: PDF or EPUB content (maximum 80 MiB compressed)
 *             required: [file]
 *     responses:
 *       202:
 *         description: Original stored and accepted for Postgres-backed processing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "File upload accepted for processing"
 *                 book:
 *                   $ref: '#/components/schemas/PublicBook'
 *                 processStatus:
 *                   type: string
 *                   example: "processing"
 *                 fileType:
 *                   type: string
 *                   example: "application/epub+zip"
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "No session provided or invalid session"
 *       400:
 *         description: Missing file or invalid PDF/EPUB content
 *       403:
 *         description: Origin does not match FRONTEND_URL
 *       413:
 *         description: Compressed upload exceeds 80 MiB
 *       429:
 *         description: Upload limit exceeded; Retry-After is returned
 *       503:
 *         description: Queue unavailable; the original is preserved as queue_failed
 *       500: { $ref: '#/components/responses/InternalError' }
 */
router.post(
    "/",
    authenticate,
    uploadRateLimit,
    upload.single("file"),
    asyncHandler(async (req, res) => {
        const requestStart = Date.now();
        log.info("Book upload request received", {
            userId: req.user.id,
            fileName: req.file?.originalname,
            mimeType: req.file?.mimetype,
        });
        try {
            if (!req.file) {
                log.warn("Book upload rejected: no file");
                res.status(400).json({ error: "No file uploaded" });
                return;
            }
            const fileBuffer = req.file.buffer;
            let acceptedUpload;
            try {
                acceptedUpload = await acceptBookUpload(
                    {
                        userId: req.user.id,
                        originalFilename: req.file.originalname,
                        buffer: fileBuffer,
                    },
                    {
                        uploadFile: async (fileKey, buffer) => {
                            await uploadFile(fileKey, buffer);
                        },
                        insertBook: async (bookValues) =>
                            persistUploadedBook(bookValues.fileKey, {
                                insertBook: async () => {
                                    const [insertedBook] = await db
                                        .insert(Books)
                                        .values(bookValues)
                                        .returning();
                                    if (!insertedBook) {
                                        throw new Error(
                                            "Book insert returned no row"
                                        );
                                    }
                                    return insertedBook;
                                },
                                deleteFile: async (fileKey) => {
                                    await deleteFile(fileKey);
                                },
                                onCleanupError: (cleanupError) => {
                                    log.error(
                                        "Failed to clean up upload after insert failure",
                                        {
                                            bookId: bookValues.id,
                                            fileKey: bookValues.fileKey,
                                            error:
                                                cleanupError instanceof Error
                                                    ? cleanupError.message
                                                    : String(cleanupError),
                                        }
                                    );
                                },
                            }),
                        enqueue: handleBookProcessingEnqueue,
                    }
                );
            } catch (error) {
                if (error instanceof BookUploadValidationError) {
                    log.warn("Book upload rejected: invalid content", {
                        mimeType: req.file.mimetype,
                        userId: req.user.id,
                    });
                    res.status(400).json({ error: "Invalid PDF or EPUB file" });
                    return;
                }
                if (error instanceof BookUploadEnqueueError) {
                    log.error("Book processing enqueue failed", {
                        error:
                            error.cause instanceof Error
                                ? error.cause.message
                                : String(error.cause),
                    });
                    res.status(503).json({
                        error: "Book processing queue is unavailable",
                    });
                    return;
                }
                throw error;
            }
            const { book, fileType, uploadPlan } = acceptedUpload;
            const mimeType =
                fileType === "pdf" ? "application/pdf" : "application/epub+zip";
            log.info("Book record created", {
                bookId: book.id,
                userId: req.user.id,
                fileKey: book.fileKey,
                fileType,
            });

            const [queuedBook] = await db
                .select(publicBookSelection)
                .from(Books)
                .where(eq(Books.id, book.id));

            const duration = Date.now() - requestStart;
            log.info("Book upload accepted", {
                bookId: book.id,
                durationMs: duration,
                fileKey: book.fileKey,
            });
            res.status(202).json({
                message: "File upload accepted for processing",
                book: queuedBook ?? toPublicBook(book),
                processStatus: "processing",
                fileType: mimeType,
            });
        } catch (e) {
            const duration = Date.now() - requestStart;
            log.error("Book upload failed", {
                userId: req.user.id,
                durationMs: duration,
                error: e instanceof Error ? e.message : String(e),
            });
            res.status(500).json({ error: "Upload failed" });
        }
    })
);

/**
 * @swagger
 * /api/books:
 *   get:
 *     tags: [Books]
 *     summary: List the current user's public book records
 *     responses:
 *       200:
 *         description: Books successfully fetched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 books:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PublicBook'
 *       401:
 *         description: Missing or invalid session cookie
 *       500: { $ref: '#/components/responses/InternalError' }
 */
router.get(
    "/",
    authenticate,
    asyncHandler(async (req, res) => {
        const booksList = await db
            .select(publicBookSelection)
            .from(Books)
            .where(eq(Books.userId, req.user.id));

        res.json({
            books: booksList,
        });
    })
);

/**
 * @swagger
 * /api/books/{bookId}/retry:
 *   post:
 *     tags: [Books]
 *     summary: Retry processing for an owned failed book
 *     parameters:
 *       - in: path
 *         name: bookId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       202:
 *         description: Retry queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [bookId, status]
 *               properties:
 *                 bookId: { type: string, format: uuid }
 *                 status: { type: string, enum: [processing] }
 *       404: { description: Owned book not found }
 *       403: { description: Origin does not match FRONTEND_URL }
 *       409: { description: Book is not queue_failed or failed }
 *       503: { description: Queue unavailable; book returns to queue_failed }
 *       500: { $ref: '#/components/responses/InternalError' }
 */
router.post(
    "/:bookId/retry",
    authenticate,
    asyncHandler(async (req, res) => {
        try {
            const result = await retryBookProcessing(
                req.params.bookId,
                req.user.id
            );
            res.status(202).json(result);
        } catch (error) {
            if (error instanceof BookProcessingRetryNotFoundError) {
                res.status(404).json({ error: error.message });
                return;
            }
            if (error instanceof BookProcessingRetryConflictError) {
                res.status(409).json({ error: error.message });
                return;
            }
            if (error instanceof BookProcessingQueueUnavailableError) {
                res.status(503).json({
                    error: "Book processing queue is unavailable",
                });
                return;
            }
            throw error;
        }
    })
);

/**
 * @swagger
 * /api/books/{bookId}/status:
 *   get:
 *     tags: [Books]
 *     summary: Get an owned book's processing status
 *     parameters:
 *       - in: path
 *         name: bookId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Current processing state
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BookStatus' }
 *       403: { description: Book belongs to another user }
 *       404: { description: Book not found }
 *       500: { $ref: '#/components/responses/InternalError' }
 */
router.get(
    "/:id/status",
    authenticate,
    asyncHandler(async (req, res) => {
        try {
            const [book] = await db
                .select()
                .from(Books)
                .where(eq(Books.id, req.params.id));

            if (!book) {
                res.status(404).json({ error: "Book was not found" });
                return;
            }

            if (book.userId !== req.user.id) {
                res.status(403).json({ error: "Not authorized" });
                return;
            }

            res.json({
                bookId: book.id,
                fileType: book.fileType,
                ready:
                    book.processingStatus === "ready" &&
                    Boolean(book.collectionName),
                status: book.processingStatus,
                error: book.processingError,
            });
        } catch (error) {
            console.error("Error fetching book processing status", error);
            res.status(500).json({ error: "Internal server error" });
        }
    })
);

/**
 * @swagger
 * /api/books/{bookId}:
 *   get:
 *     tags: [Books]
 *     summary: Download an owned book by public UUID
 *     description: Resolves the private storage key only after ownership succeeds. Responses are private and use nosniff.
 *     parameters:
 *       - in: path
 *         name: bookId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Book successfully fetched
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *           application/epub+zip:
 *             schema:
 *               type: string
 *               format: binary
 *           application/octet-stream:
 *             schema: { type: string, format: binary }
 *       403: { description: Book belongs to another user }
 *       404: { description: Book not found }
 *       500: { $ref: '#/components/responses/InternalError' }
 */

router.get(
    "/:id",
    authenticate,
    asyncHandler(async (req, res) => {
        await handleBookFileDelivery(req.params.id, req.user.id, res, {
            async findBookById(bookId) {
                const [book] = await db
                    .select()
                    .from(Books)
                    .where(eq(Books.id, bookId));
                return book;
            },
            getFile,
        });
    })
);

/**
 * @swagger
 * /api/books/{bookId}:
 *   delete:
 *     tags: [Books]
 *     summary: Delete an owned book and its artifacts
 *     description: Marks the book deleting, removes queued work, and cleans private artifacts. Repeat the request if cleanup fails while the row remains deleting.
 *     parameters:
 *       - in: path
 *         name: bookId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Book and artifacts deleted }
 *       403: { description: Book belongs to another user }
 *       404: { description: Book not found }
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete(
    "/:id",
    authenticate,
    asyncHandler(async (req, res) => {
        const bookId = req.params.id;
        log.info("Book delete request received", {
            bookId,
            userId: req.user.id,
        });

        try {
            await deleteOwnedBook(bookId, req.user.id);

            log.info("Book delete successful", { bookId });
            res.status(204).send();
        } catch (e) {
            if (e instanceof BookDeletionNotFoundError) {
                res.status(404).json({ error: e.message });
                return;
            }
            if (e instanceof BookDeletionForbiddenError) {
                res.status(403).json({ error: e.message });
                return;
            }
            log.error("Book delete failed", {
                bookId,
                error: e instanceof Error ? e.message : String(e),
            });
            res.status(500).json({
                error: "Failed to delete the file",
            });
        }
    })
);
export default router;
