import { Router } from "express";
const router = Router();
import multer from "multer";
import {
    createLogger,
    deleteFile,
    getFile,
    uploadFile,
    vectorStore,
} from "@reader/providers";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { db } from "../db";
import { Books } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { bookSearchChunkStore } from "../services/BookSearchChunkStore";
import { hybridBookSearchService } from "../services/HybridBookSearchService";
import { handleBookProcessingEnqueue } from "../services/BookProcessingEnqueueService";
import { handleBookFileDelivery } from "../services/BookFileDelivery";
import { publicBookSelection, toPublicBook } from "../services/PublicBook";
import { persistUploadedBook } from "../services/BookUploadService";
import {
    acceptBookUpload,
    BookUploadEnqueueError,
    BookUploadValidationError,
} from "../services/BookUploadAcceptanceService";

const log = createLogger("books");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 80 * 1024 * 1024, // 80 mb
    },
});

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique identifier for the user
 *         name:
 *           type: string
 *           description: User's full name
 *         email:
 *           type: string
 *           description: User's email address
 *         googleId:
 *           type: string
 *           description: User's Google ID
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     PublicBook:
 *       type: object
 *       required: [id, title, fileType, processingStatus, createdAt]
 *       properties:
 *         id:
 *           type: string
 *           description: Unique identifier for the book
 *         title:
 *           type: string
 *           description: Book title
 *         fileType:
 *           type: string
 *           nullable: true
 *           enum: [epub, pdf]
 *         processingStatus:
 *           type: string
 *         processingError:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/books:
 *   post:
 *     tags: [Books]
 *     summary: Upload EPUB or PDF file
 *     description: Uploads an EPUB or PDF file and queues asynchronous embedding generation.
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
 *                 description: EPUB or PDF file to upload (max 80MB)
 *     responses:
 *       202:
 *         description: File successfully uploaded and accepted for processing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "File upload successful"
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
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "No file uploaded or invalid file format"
 *       413:
 *         description: Payload too large
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "File size exceeds 80MB limit"
 */
router.post(
    "/",
    authenticate,
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
                        title: req.file.originalname,
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
 * tags:
 *   - name: Books
 *     description: Book management endpoints
 *
 * /api/books:
 *   get:
 *     tags: [Books]
 *     summary: Get all books uploaded by user
 *     description: Get all books uploaded by the user
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
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "No session provided"
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
 * tags:
 *   - name: Books
 *     description: Book management endpoints
 *
 * /api/books/{id}:
 *   get:
 *     tags: [Books]
 *     summary: Get book by id
 *     description: Get book by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Book ID
 *     responses:
 *       200:
 *         description: Book successfully fetched
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "No session provided"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Internal server error"
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
// working
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
            const [book] = await db
                .select()
                .from(Books)
                .where(eq(Books.id, bookId));
            if (!book) {
                log.warn("Book delete failed: not found", { bookId });
                res.status(404).json({
                    error: "Book was not found",
                });
                return;
            }
            if (book.userId !== req.user.id) {
                log.warn("Book delete failed: unauthorized", {
                    bookId,
                    userId: req.user.id,
                    ownerId: book.userId,
                });
                res.status(403).json({
                    error: "Not authorized",
                });
                return;
            }
            await db.delete(Books).where(eq(Books.id, bookId));
            log.info("Book record deleted", { bookId });

            const [remaining] = await db
                .select({ count: sql`count(*)`.mapWith(Number) })
                .from(Books)
                .where(eq(Books.fileKey, book.fileKey));
            if (remaining.count === 0) {
                log.info("Deleting orphaned file and collection", {
                    fileKey: book.fileKey,
                    collectionName: book.collectionName,
                });
                await deleteFile(book.fileKey);

                if (book.collectionName) {
                    await vectorStore.deleteCollection(book.collectionName);
                    await bookSearchChunkStore.deleteCollectionChunks(
                        book.collectionName
                    );
                    hybridBookSearchService.clearCollectionCache(
                        book.collectionName
                    );
                }
            } else {
                log.debug("Skipping cleanup, file still referenced", {
                    fileKey: book.fileKey,
                    remainingCount: remaining.count,
                });
            }

            log.info("Book delete successful", { bookId });
            res.status(204).send();
        } catch (e) {
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
