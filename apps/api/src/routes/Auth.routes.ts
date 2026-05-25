import express, { Router } from "express";
import {
    getOrCreateDevUser,
    generateToken,
    verifyGoogleToken,
} from "../services/AuthService";
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
 *                 description: Google OAuth ID token
 *                 example: "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFiZDY3..."
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
 *                   description: JWT access token
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVC..."
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Invalid Google OAuth token"
 */

router.post("/google", async (req, res) => {
    try {
        const { token } = req.body;
        const payload = await verifyGoogleToken(token);
        const [existingUser] = await db
            .select()
            .from(Users)
            .where(eq(Users.googleId, payload.sub));

        let user = existingUser;
        if (!user) {
            [user] = await db
                .insert(Users)
                .values({
                    googleId: payload.sub,
                    email: payload.email,
                    name: payload.name,
                    // picture: payload.picture
                })
                .returning();
        } else {
            [user] = await db
                .update(Users)
                .set({ updatedAt: new Date() })
                .where(eq(Users.googleId, payload.sub))
                .returning();
        }

        const jwtToken = generateToken(user);
        res.json({ token: jwtToken, user });
    } catch (e) {
        console.error(e);
        res.status(401).json({ message: "Authentication failed" });
    }
});

router.post("/dev", async (_req, res) => {
    if (process.env.NODE_ENV === "production") {
        res.status(404).json({ message: "Not found" });
        return;
    }

    try {
        const user = await getOrCreateDevUser();
        const token = generateToken(user);
        res.json({ token, user });
    } catch (error) {
        console.error("Dev auth failed", error);
        res.status(500).json({ message: "Dev auth failed" });
    }
});

export default router;
