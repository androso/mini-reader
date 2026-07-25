import { eq } from "drizzle-orm";
import { Router, type Response } from "express";
import { db } from "../db";
import { CodexCredentials } from "../db/schema";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate } from "../middleware/auth";
import { codexAuthRateLimit } from "../middleware/rateLimit";
import { isCodexOAuthEnabled } from "../services/CodexCredentialService";
import {
    CODEX_MODEL,
    CODEX_MODELS,
    CodexOAuthError,
    CodexOAuthService,
} from "../services/CodexOAuthService";
import {
    OPENAI_CHAT_MODEL,
    OPENAI_CHAT_MODELS,
} from "../services/OpenAIServices";

const router = Router();
const oauth = new CodexOAuthService();

const getStatus = async (userId: string) => {
    const codexAvailable = isCodexOAuthEnabled();
    const [credential] = codexAvailable
        ? await db
              .select({
                  accessTokenEncrypted: CodexCredentials.accessTokenEncrypted,
                  refreshTokenEncrypted: CodexCredentials.refreshTokenEncrypted,
                  accountId: CodexCredentials.accountId,
                  email: CodexCredentials.email,
                  planType: CodexCredentials.planType,
                  reauthRequired: CodexCredentials.reauthRequired,
              })
              .from(CodexCredentials)
              .where(eq(CodexCredentials.userId, userId))
              .limit(1)
        : [];
    const connected = Boolean(
        credential?.accessTokenEncrypted &&
            credential.refreshTokenEncrypted &&
            credential.accountId &&
            !credential.reauthRequired
    );
    return {
        codexAvailable,
        provider: connected ? ("codex" as const) : ("openai" as const),
        connected,
        reauthRequired: Boolean(credential?.reauthRequired),
        account:
            connected && (credential?.email || credential?.planType)
                ? {
                      email: credential.email,
                      planType: credential.planType,
                  }
                : null,
        models: connected ? [...CODEX_MODELS] : [...OPENAI_CHAT_MODELS],
        defaultModel: connected ? CODEX_MODEL : OPENAI_CHAT_MODEL,
    };
};

const requireEnabled = () => {
    if (!isCodexOAuthEnabled()) {
        throw new CodexOAuthError("Codex OAuth is not enabled", 503);
    }
};

const sendOAuthError = (error: unknown, res: Response) => {
    if (error instanceof CodexOAuthError) {
        res.status(error.status).json({ error: error.message });
        return true;
    }
    return false;
};

/**
 * @swagger
 * /api/chat-provider:
 *   get:
 *     tags: [Chat Provider]
 *     summary: Get the authenticated user's chat provider
 *     responses:
 *       200:
 *         description: Chat provider status
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ChatProviderStatus' }
 */
router.get(
    "/",
    authenticate,
    asyncHandler(async (req, res) => {
        res.json(await getStatus(req.user.id));
    })
);

/**
 * @swagger
 * /api/chat-provider/codex/authorize:
 *   post:
 *     tags: [Chat Provider]
 *     summary: Start manual Codex authorization
 *     responses:
 *       200:
 *         description: Authorization URL and expiry
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/CodexAuthorization' }
 *       503:
 *         description: Codex OAuth is disabled
 */
router.post(
    "/codex/authorize",
    authenticate,
    codexAuthRateLimit,
    asyncHandler(async (req, res) => {
        try {
            requireEnabled();
            const result = await oauth.startAuthorization(req.user.id);
            res.json({
                authorizationUrl: result.authorizationUrl,
                expiresAt: result.expiresAt.toISOString(),
            });
        } catch (error) {
            if (!sendOAuthError(error, res)) throw error;
        }
    })
);

/**
 * @swagger
 * /api/chat-provider/codex/complete:
 *   post:
 *     tags: [Chat Provider]
 *     summary: Complete manual Codex authorization
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CodexCompletionRequest' }
 *     responses:
 *       200:
 *         description: Updated chat provider status
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ChatProviderStatus' }
 *       400:
 *         description: Invalid or expired callback
 */
router.post(
    "/codex/complete",
    authenticate,
    codexAuthRateLimit,
    asyncHandler(async (req, res) => {
        try {
            requireEnabled();
            const body = req.body as Record<string, unknown> | null;
            if (
                !body ||
                Object.keys(body).length !== 1 ||
                typeof body.redirectUrl !== "string" ||
                !body.redirectUrl
            ) {
                res.status(400).json({ error: "redirectUrl is required" });
                return;
            }
            await oauth.completeAuthorization(req.user.id, body.redirectUrl);
            res.json(await getStatus(req.user.id));
        } catch (error) {
            if (!sendOAuthError(error, res)) throw error;
        }
    })
);

/**
 * @swagger
 * /api/chat-provider/codex:
 *   delete:
 *     tags: [Chat Provider]
 *     summary: Disconnect the authenticated user's Codex account
 *     responses:
 *       204:
 *         description: Disconnected
 */
router.delete(
    "/codex",
    authenticate,
    codexAuthRateLimit,
    asyncHandler(async (req, res) => {
        try {
            requireEnabled();
            await db
                .delete(CodexCredentials)
                .where(eq(CodexCredentials.userId, req.user.id));
            res.status(204).end();
        } catch (error) {
            if (!sendOAuthError(error, res)) throw error;
        }
    })
);

export default router;
