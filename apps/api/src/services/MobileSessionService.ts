import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, pool } from "../db";
import { MobileSessions, Users } from "../db/schema";

export const MOBILE_ACCESS_TOKEN_SECONDS = 15 * 60;
export const MOBILE_REFRESH_TOKEN_DAYS = 30;

type MobileAccessClaims = {
    userId: string;
    sessionId: string;
    tokenType: "mobile-access";
};

export const hashRefreshSecret = (secret: string) =>
    createHash("sha256").update(secret, "utf8").digest("hex");

const refreshExpiry = () =>
    new Date(Date.now() + MOBILE_REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

const issueAccessToken = (userId: string, sessionId: string) =>
    jwt.sign(
        { userId, sessionId, tokenType: "mobile-access" },
        process.env.JWT_SECRET!,
        { expiresIn: MOBILE_ACCESS_TOKEN_SECONDS }
    );

export const parseRefreshToken = (
    token: unknown
): { sessionId: string; secret: string } | null => {
    if (typeof token !== "string") return null;
    const [sessionId, secret, extra] = token.split(".");
    if (
        extra !== undefined ||
        !/^[0-9a-f-]{36}$/i.test(sessionId ?? "") ||
        !/^[A-Za-z0-9_-]{43}$/.test(secret ?? "")
    ) {
        return null;
    }
    return { sessionId, secret };
};

export const secretsMatch = (actual: string, expectedHash: string) => {
    const actualHash = Buffer.from(hashRefreshSecret(actual), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return (
        actualHash.length === expected.length &&
        timingSafeEqual(actualHash, expected)
    );
};

export const createMobileSession = async (userId: string) => {
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = refreshExpiry();
    const [session] = await db
        .insert(MobileSessions)
        .values({
            userId,
            tokenHash: hashRefreshSecret(secret),
            expiresAt,
        })
        .returning({ id: MobileSessions.id });
    if (!session) throw new Error("Mobile session insert returned no row");

    return {
        accessToken: issueAccessToken(userId, session.id),
        refreshToken: `${session.id}.${secret}`,
        accessTokenExpiresIn: MOBILE_ACCESS_TOKEN_SECONDS,
        refreshTokenExpiresAt: expiresAt.toISOString(),
    };
};

export const verifyMobileAccessToken = async (token: string) => {
    try {
        const claims = jwt.verify(
            token,
            process.env.JWT_SECRET!
        ) as MobileAccessClaims;
        if (
            claims.tokenType !== "mobile-access" ||
            !claims.userId ||
            !claims.sessionId
        ) {
            return null;
        }
        const [row] = await db
            .select({ user: Users })
            .from(MobileSessions)
            .innerJoin(Users, eq(Users.id, MobileSessions.userId))
            .where(
                and(
                    eq(MobileSessions.id, claims.sessionId),
                    eq(MobileSessions.userId, claims.userId),
                    isNull(MobileSessions.revokedAt),
                    gt(MobileSessions.expiresAt, new Date())
                )
            );
        return row?.user
            ? {
                  user: row.user,
                  sessionId: claims.sessionId,
              }
            : null;
    } catch {
        return null;
    }
};

export const rotateMobileSession = async (token: unknown) => {
    const parsed = parseRefreshToken(token);
    if (!parsed) return null;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query<{
            id: string;
            user_id: string;
            token_hash: string;
            expires_at: Date;
            revoked_at: Date | null;
        }>(
            `SELECT id, user_id, token_hash, expires_at, revoked_at
             FROM mobile_sessions
             WHERE id = $1
             FOR UPDATE`,
            [parsed.sessionId]
        );
        const row = current.rows[0];
        if (
            !row ||
            row.revoked_at ||
            row.expires_at <= new Date() ||
            !secretsMatch(parsed.secret, row.token_hash)
        ) {
            if (row) {
                await client.query(
                    `UPDATE mobile_sessions
                     SET revoked_at = now(), updated_at = now()
                     WHERE user_id = $1 AND revoked_at IS NULL`,
                    [row.user_id]
                );
            }
            await client.query("COMMIT");
            return null;
        }

        const nextSecret = randomBytes(32).toString("base64url");
        const nextExpiry = refreshExpiry();
        const next = await client.query<{ id: string }>(
            `INSERT INTO mobile_sessions (user_id, token_hash, expires_at)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [row.user_id, hashRefreshSecret(nextSecret), nextExpiry]
        );
        const nextId = next.rows[0]?.id;
        if (!nextId) throw new Error("Mobile session rotation returned no row");

        await client.query(
            `UPDATE mobile_sessions
             SET revoked_at = now(), replaced_by_id = $2, last_used_at = now(), updated_at = now()
             WHERE id = $1`,
            [row.id, nextId]
        );
        await client.query("COMMIT");

        const [user] = await db
            .select()
            .from(Users)
            .where(eq(Users.id, row.user_id));
        if (!user) return null;
        return {
            user,
            accessToken: issueAccessToken(row.user_id, nextId),
            refreshToken: `${nextId}.${nextSecret}`,
            accessTokenExpiresIn: MOBILE_ACCESS_TOKEN_SECONDS,
            refreshTokenExpiresAt: nextExpiry.toISOString(),
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

export const revokeMobileSession = async (token: unknown) => {
    const parsed = parseRefreshToken(token);
    if (!parsed) return;
    const [session] = await db
        .select()
        .from(MobileSessions)
        .where(eq(MobileSessions.id, parsed.sessionId));
    if (!session || !secretsMatch(parsed.secret, session.tokenHash)) return;
    await db
        .update(MobileSessions)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(MobileSessions.id, parsed.sessionId));
};
