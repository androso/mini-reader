import { Router } from "express";
import { authenticate } from "../middleware/auth";

const router = Router();
//@ts-ignore
/**
 * @swagger
 * /api/user:
 *   get:
 *     tags:
 *       - User
 *     summary: Get current user information
 *     description: Retrieves the authenticated user's information
 *     responses:
 *       200:
 *         description: Successfully retrieved user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "No session provided or invalid session"
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

router.get("/", authenticate, (req, res) => {
    res.json({ user: req.user });
});

export default router;
