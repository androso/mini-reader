import express, { Router } from "express";
import { generateToken, verifyGoogleToken } from "../services/AuthService";
import { db } from "../db";
import { Users } from "../db/schema";
import { eq } from "drizzle-orm";
const router: Router = express.Router();

/**
 * @swagger
 * /auth/google:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Authenticate user with Google OAuth token
 *     description: Validates Google OAuth token and creates/updates user in database
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: Google OAuth token
 *             required:
 *               - token
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: JWT token for authenticated user
 *                 user:
 *                   type: object
 *                   description: User details
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Authentication failed
 */

router.post("/google", async (req, res) => {
	try {
		const { token } = req.body;
		const payload = await verifyGoogleToken(token);
		const user = await db
			.select()
			.from(Users)
			.where(eq(Users.googleId, payload.sub));

		if (user.length === 0) {
			await db.insert(Users).values({
				googleId: payload.sub,
				email: payload.email,
				name: payload.name,
				// picture: payload.picture
			});
		} else {
			await db
				.update(Users)
				.set({ updatedAt: new Date() })
				.where(eq(Users.googleId, payload.sub));
		}
		
		const jwtToken = generateToken(user[0]);
		res.json({ token: jwtToken, user: user[0] });
	} catch (e) {
		console.error(e);
		res.status(401).json({ message: "Authentication failed" });
	}
});

export default router;
