import { Router } from "express";
const router = Router();
import multer from "multer";
import { getFile, uploadFile } from "../utils/storage";
import { authenticate } from "../middleware/auth";
import { db } from "../db";
import { books } from "../../migrations/schema";
import { eq } from "drizzle-orm";
import { queryController, QueryController } from "../controllers/QueryControllers";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 80 * 1024 * 1024, // 80 mb
    },
});
/**
 * @swagger
 * tags:
 *   - name: Books
 *     description: Book management endpoints
 * 
 * /api/books:
 *   post:
 *     tags: [Books]
 *     security:
 *       - bearerAuth: []
 *     summary: Upload and process EPUB file
 *     description: Uploads an EPUB file, creates embeddings, and stores in ChromaDB
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
 *     responses:
 *       200:
 *         description: File successfully uploaded and processed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "File upload succesfull"
 *                 book:
 *                   type: object
 *                   properties:
 *                     title:
 *                       type: string
 *                       example: "cordwainer-smith_short-fiction.epub"
 *                     userId:
 *                       type: string
 *                       example: "1ba8cd628f61"
 *                     fileKey:
 *                       type: string
 *                       example: "fdd2a6cd-f354-4428-9084-a893a9132318-1736868043356-cordwainer-smith_short-fiction.epub"
 *                 collection:
 *                   type: string
 *                   example: "book_1ba8cd628f61"
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "No token provided"
 *       400:
 *         description: Upload failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Upload failed"
 */
router.post("/", authenticate, upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        } else {
            const fileBuffer = req.file.buffer;
            const fileName = `${req.user.id}-${Date.now()}-${req?.file.originalname}`;
            await uploadFile(fileName, fileBuffer);
            const collection = await queryController.handleProcess(fileBuffer);
            if(collection.error) {
                res.status(500).json({ error: "Error processing file to generate a collection" });
                return;
            }

            // create embeddings from file 
             
            const [book] = await db
                .insert(books)
                .values({
                    title: req.file.originalname,
                    userId: req.user.id,
                    fileKey: fileName,
                })
                .returning();

            return res.json({
                message: "File upload succesfull",
                book,
                collection: collection.collectionName
            });
        }
    } catch (e) {
        console.error("Upload Error", e);

        return Response.json(
            {
                error: "Upload failed",
            },
            {
                status: 500,
            },
        );
    }
});

/**
 * @swagger
 * tags:
 *   - name: Books
 *     description: Book management endpoints
 * 
 * /api/books:
 *   get:
 *     tags: [Books]
 *     security:
 *       - bearerAuth: []
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
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         example: "1ba8cd628f61"
 *                       title:
 *                         type: string
 *                         example: "cordwainer-smith_short-fiction.epub"
 *                       userId:
 *                         type: string
 *                         example: "1ba8cd628f61"
 *                       fileKey:
 *                         type: string
 *                         example: "fdd2a6cd-f354-4428-9084-a893a9132318-1736868043356-cordwainer-smith_short-fiction.epub"
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "No token provided"
 */
router.get("/", authenticate, async (req, res) => {
    const booksList = await db
        .select()
        .from(books)
        .where(eq(books.userId, req.user.id));

    return res.json({
        books: booksList,
    });
});

/**
 * @swagger
 * tags:
 *   - name: Books
 *     description: Book management endpoints
 * 
 * /api/books/{id}:
 *   get:
 *     tags: [Books]
 *     security:
 *       - bearerAuth: []
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
 *                   example: "No token provided"
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

router.get("/:id", authenticate, async (req, res) => {
    const id = req.params.id;

    try {
        const fileBuffer = await getFile(id) 
        res.type('application/octet-stream');
        res.send(fileBuffer)
        
    } catch(er) {
        console.error("Error fetching file", er) 
        res.status(500).json({ error: "Internal server error"});
    }
});

export default router;
