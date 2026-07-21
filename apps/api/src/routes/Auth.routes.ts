import express, { Request, RequestHandler, Response, Router } from "express";
import {
    getOrCreateDevUser,
    generateToken,
    verifyGoogleToken,
    registerEmailUser,
    authenticateEmailUser,
    emailAuthRepository,
    EmailAuthRepository,
} from "../services/AuthService";
import { db } from "../db";
import { Users } from "../db/schema";
import { eq } from "drizzle-orm";
import { clearAuthCookies, setAuthCookie } from "../utils/authCookie";
import { asyncHandler } from "../middleware/asyncHandler";
const router: Router = express.Router();

export interface PublicUser {
    id: string;
    email: string;
    name: string;
    image: string | null;
    username: string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
}

export const toPublicUser = (user: unknown): PublicUser => {
    const u = user as Record<string, unknown>;
    return {
        id: u.id as string,
        email: u.email as string,
        name: u.name as string,
        image: (u.image as string | null | undefined) ?? null,
        username: (u.username as string | null | undefined) ?? null,
        createdAt: u.createdAt as Date | string,
        updatedAt: u.updatedAt as Date | string,
    };
};

export const authResponse = (user: unknown) => ({ user: toPublicUser(user) });

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
 *       500: { $ref: '#/components/responses/InternalError' }
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
 * /api/auth/signup:
 *   post:
 *     tags:
 *       - Auth
 *     security: []
 *     summary: Register a new email/password user
 *     description: Creates a user with unique email and username, hashes the password, and sets an HttpOnly session cookie
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - email
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: "reader_one"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "reader@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "securePassword123"
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       409:
 *         description: Email or username already registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Email or username is already registered"
 *       403:
 *         description: Origin does not match FRONTEND_URL
 *       429:
 *         description: Authentication limit exceeded; Retry-After is returned
 */
export const createSignupHandler = (
    repository: EmailAuthRepository = emailAuthRepository
): RequestHandler =>
    asyncHandler(async (req: Request, res: Response) => {
        const result = await registerEmailUser(req.body, repository);
        if (!result.ok) {
            res.status(result.status).json({ message: result.message });
            return;
        }
        // TODO(email-confirmation): require verification before issuing a signup session once mail delivery is available.
        const token = generateToken(result.user);
        setAuthCookie(res, token);
        res.status(201).json(authResponse(result.user));
    });

router.post("/signup", createSignupHandler());

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     security: []
 *     summary: Authenticate user with email and password
 *     description: Verifies email credentials and sets an HttpOnly session cookie
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "reader@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "securePassword123"
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
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Invalid email or password"
 *       403:
 *         description: Origin does not match FRONTEND_URL
 *       429:
 *         description: Authentication limit exceeded; Retry-After is returned
 */
export const createLoginHandler = (
    repository: EmailAuthRepository = emailAuthRepository
): RequestHandler =>
    asyncHandler(async (req: Request, res: Response) => {
        const result = await authenticateEmailUser(req.body, repository);
        if (!result.ok) {
            res.status(result.status).json({ message: result.message });
            return;
        }
        const token = generateToken(result.user);
        setAuthCookie(res, token);
        res.status(200).json(authResponse(result.user));
    });

router.post("/login", createLoginHandler());

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
