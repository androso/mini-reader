import { Router } from "express";
const router = Router();
import multer from "multer";
import { getFile, uploadFile } from "../utils/storage";
import { authenticate } from "../middleware/auth";
import { db } from "../db";
import { books } from "../../migrations/schema";
import { eq } from "drizzle-orm";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 80 * 1024 * 1024, // 80 mb
    },
});

router.post("/", authenticate, upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        } else {
            const fileBuffer = req.file.buffer;
            const fileName = `${req.user.id}-${Date.now()}-${req?.file.originalname}`;
            await uploadFile(fileName, fileBuffer);

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

router.get("/", authenticate, async (req, res) => {
    const booksList = await db
        .select()
        .from(books)
        .where(eq(books.userId, req.user.id));

    return res.json({
        books: booksList,
    });
});

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
