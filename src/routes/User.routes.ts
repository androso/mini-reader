import { Router } from "express";
import { authenticate } from "../middleware/auth";

const router = Router();
//@ts-ignore
/**
 * @swagger
 * /api/users:
 *   get:
 *     tags:
 *       - User
 *     summary: Get current user information
 *     description: Retrieves the authenticated user's information
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   description: User object containing user details
 *       401:
 *         description: Unauthorized - Invalid or missing authentication token
 *       500:
 *         description: Internal server error
 */

router.get("/", authenticate, (req, res) => {
	res.json({ user: req.user });
});

export default router;
