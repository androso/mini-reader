import express, { Router } from "express";
import {
    getOrCreateDevUser,
    generateToken,
    verifyGoogleToken,
} from "../services/AuthService";
import { db } from "../db";
import { Users } from "../db/schema";
import { eq } from "drizzle-orm";
import { clearAuthCookies, setAuthCookie } from "../utils/authCookie";
import { asyncHandler } from "../middleware/asyncHandler";
const router: Router = express.Router();

export const authResponse = <T>(user: T) => ({ user });

/**
 * @swagger
 * /api/auth/google:
 *   post:
 *     tags:
 *       - Auth
 *     security: []
 *     summary: Authenticate user with a Google ID token
 *     description: Verifies a Google ID token, creates or updates the user, and sets an HttpOnly session cookie
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Google OAuth ID token
 *                 example: "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFiZDY3..."
 *             required:
 *               - idToken
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
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
 *       403:
 *         description: Origin does not match FRONTEND_URL
 *       429:
 *         description: Authentication limit exceeded; Retry-After is returned
 */

router.post(
    "/google",
    asyncHandler(async (req, res) => {
        try {
            const { idToken } = req.body;
            const payload = await verifyGoogleToken(idToken);
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
            setAuthCookie(res, jwtToken);
            res.json(authResponse(user));
        } catch (e) {
            console.error(e);
            res.status(401).json({ message: "Authentication failed" });
        }
    })
);

/**
 * @swagger
 * /api/auth/dev:
 *   post:
 *     tags: [Auth]
 *     security: []
 *     summary: Create a local development session
 *     description: Available outside production only; sets reader_session.
 *     responses:
 *       200:
 *         description: Development session created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       403: { description: Origin does not match FRONTEND_URL }
 *       404: { description: Disabled in production }
 *       429: { description: Authentication limit exceeded; Retry-After is returned }
 */
router.post(
    "/dev",
    asyncHandler(async (_req, res) => {
        if (process.env.NODE_ENV === "production") {
            res.status(404).json({ message: "Not found" });
            return;
        }

        try {
            const user = await getOrCreateDevUser();
            const token = generateToken(user);
            setAuthCookie(res, token);
            res.json(authResponse(user));
        } catch (error) {
            console.error("Dev auth failed", error);
            res.status(500).json({ message: "Dev auth failed" });
        }
    })
);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags:
 *       - Auth
 *     security: []
 *     summary: End the current Reader session
 *     responses:
 *       204:
 *         description: Session cookies cleared
 *       403:
 *         description: Origin does not match FRONTEND_URL
 *       429:
 *         description: Authentication limit exceeded; Retry-After is returned
 */
export const logout = (_req: express.Request, res: express.Response) => {
    clearAuthCookies(res);
    res.status(204).end();
};

router.post("/logout", logout);

export default router;
