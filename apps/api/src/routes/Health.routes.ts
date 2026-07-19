import { Router } from "express";

const router = Router();

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     security: []
 *     summary: Check API health
 *     responses:
 *       200:
 *         description: API process is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [status]
 *               properties:
 *                 status: { type: string, enum: [ok] }
 */
router.get("/", (_req, res) => {
    res.status(200).json({ status: "ok" });
});

export default router;
