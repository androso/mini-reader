import { scrypt as scryptCb, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { db } from "../db";
import { Users } from "../db/schema";
import { eq } from "drizzle-orm";

if (!process.env.JWT_SECRET) {
    throw new Error("Missing required JWT_SECRET environment variable");
}

if (process.env.NODE_ENV === "production" && !process.env.GOOGLE_CLIENT_ID) {
    throw new Error("Missing required GOOGLE_CLIENT_ID environment variable");
}

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

type GoogleIdTokenVerifier = Pick<OAuth2Client, "verifyIdToken">;

export const verifyGoogleToken = async (
    idToken: string,
    verifier: GoogleIdTokenVerifier = client
) => {
    try {
        if (!idToken || !process.env.GOOGLE_CLIENT_ID) {
            throw new Error("Google ID token or client ID is missing");
        }

        const ticket = await verifier.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const data = ticket.getPayload();
        if (!data?.sub || !data.email) {
            throw new Error(
                "Google ID token is missing required identity claims"
            );
        }

        return {
            sub: data.sub,
            email: data.email,
            name: data.name ?? data.email,
            picture: data.picture,
        };
    } catch {
        throw new Error("Failed to verify token");
    }
};

export const generateToken = (user: any) => {
    const tk = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
        expiresIn: "7d",
    });
    return tk;
};

export const getOrCreateDevUser = async () => {
    if (process.env.NODE_ENV === "production") {
        throw new Error("Dev auth is not available in production");
    }

    const email = process.env.DEV_USER_EMAIL || "dev@example.com";
    const name = process.env.DEV_USER_NAME || "Dev User";

    const [existingUser] = await db
        .select()
        .from(Users)
        .where(eq(Users.email, email));

    if (existingUser) return existingUser;

    const [user] = await db
        .insert(Users)
        .values({
            email,
            name,
            username: "dev",
        })
        .returning();

    return user;
};

export const verifyToken = async (token: any) => {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
            userId: string;
        };

        const [user] = await db
            .select()
            .from(Users)
            .where(eq(Users.id, decoded.userId));
        return user;
    } catch (e) {
        console.error(e);
        return null;
    }
};
const scryptPromise = (
    password: string | Buffer,
    salt: Buffer,
    keylen: number,
    options: { N: number; r: number; p: number; maxmem: number }
): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        scryptCb(password, salt, keylen, options, (err, derivedKey) => {
            if (err) reject(err);
            else resolve(derivedKey);
        });
    });

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

const DUMMY_HASH = `scrypt$v1$16384$8$1$${"A".repeat(22)}${"A".repeat(86)}`;

export type SelectUser = typeof Users.$inferSelect;

export const hashPassword = async (password: string): Promise<string> => {
    const saltBuf = randomBytes(16);
    const derivedKey = await scryptPromise(password, saltBuf, KEY_LEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: 32 * 1024 * 1024,
    });

    const saltB64 = saltBuf.toString("base64url");
    const keyB64 = derivedKey.toString("base64url");
    return `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${saltB64}$${keyB64}`;
};

export const verifyPassword = async (
    password: string,
    encodedHash: string
): Promise<boolean> => {
    try {
        if (!encodedHash || typeof encodedHash !== "string") return false;
        const parts = encodedHash.split("$");
        if (parts.length !== 7) return false;
        const [prefix, version, nStr, rStr, pStr, saltB64, keyB64] = parts;
        if (prefix !== "scrypt" || version !== "v1") return false;
        const N = parseInt(nStr, 10);
        const r = parseInt(rStr, 10);
        const p = parseInt(pStr, 10);
        if (isNaN(N) || isNaN(r) || isNaN(p)) return false;

        const saltBuf = Buffer.from(saltB64, "base64url");
        const keyBuf = Buffer.from(keyB64, "base64url");
        if (saltBuf.length !== 16 || keyBuf.length !== KEY_LEN) return false;

        const derivedKey = await scryptPromise(
            password,
            saltBuf,
            keyBuf.length,
            {
                N,
                r,
                p,
                maxmem: 32 * 1024 * 1024,
            }
        );

        if (derivedKey.length !== keyBuf.length) return false;
        return timingSafeEqual(derivedKey, keyBuf);
    } catch {
        return false;
    }
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[A-Za-z0-9_]+$/;

export const validateEmailInput = (email: unknown): string | null => {
    if (
        typeof email !== "string" ||
        !email.trim() ||
        email.trim().length > 254 ||
        !EMAIL_REGEX.test(email.trim())
    ) {
        return "Enter a valid email address";
    }
    return null;
};

export const validateUsernameInput = (username: unknown): string | null => {
    if (typeof username !== "string") {
        return "Username must be 3-30 characters using letters, numbers, or underscores";
    }
    const trimmed = username.trim();
    if (
        trimmed.length < 3 ||
        trimmed.length > 30 ||
        !USERNAME_REGEX.test(trimmed)
    ) {
        return "Username must be 3-30 characters using letters, numbers, or underscores";
    }
    return null;
};

export const validatePasswordInput = (password: unknown): string | null => {
    if (
        typeof password !== "string" ||
        password.length < 8 ||
        password.length > 128
    ) {
        return "Password must be 8-128 characters";
    }
    return null;
};

export interface EmailAuthRepository {
    findByEmail(email: string): Promise<SelectUser | undefined>;
    findByUsername(username: string): Promise<SelectUser | undefined>;
    createUser(input: {
        username: string;
        name: string;
        email: string;
        passwordHash: string;
    }): Promise<SelectUser>;
}

export const emailAuthRepository: EmailAuthRepository = {
    async findByEmail(email: string): Promise<SelectUser | undefined> {
        const [user] = await db
            .select()
            .from(Users)
            .where(eq(Users.email, email.toLowerCase()));
        return user;
    },
    async findByUsername(username: string): Promise<SelectUser | undefined> {
        const [user] = await db
            .select()
            .from(Users)
            .where(eq(Users.username, username.toLowerCase()));
        return user;
    },
    async createUser(input: {
        username: string;
        name: string;
        email: string;
        passwordHash: string;
    }): Promise<SelectUser> {
        const [user] = await db
            .insert(Users)
            .values({
                username: input.username,
                name: input.name,
                email: input.email,
                passwordHash: input.passwordHash,
            })
            .returning();
        return user;
    },
};

export type EmailAuthResult =
    | { ok: true; user: SelectUser }
    | { ok: false; status: 400 | 401 | 409; message: string };

export const registerEmailUser = async (
    input: unknown,
    repository: EmailAuthRepository = emailAuthRepository
): Promise<EmailAuthResult> => {
    if (!input || typeof input !== "object") {
        return { ok: false, status: 400, message: "Invalid request payload" };
    }
    const payload = input as Record<string, unknown>;
    const { username, email, password } = payload;

    const emailErr = validateEmailInput(email);
    if (emailErr) return { ok: false, status: 400, message: emailErr };

    const usernameErr = validateUsernameInput(username);
    if (usernameErr) return { ok: false, status: 400, message: usernameErr };

    const passwordErr = validatePasswordInput(password);
    if (passwordErr) return { ok: false, status: 400, message: passwordErr };

    const rawEmail = email as string;
    const rawUsername = username as string;
    const rawPassword = password as string;

    const normalizedEmail = rawEmail.trim().toLowerCase();
    const trimmedName = rawUsername.trim();
    const normalizedUsername = trimmedName.toLowerCase();

    const existingEmail = await repository.findByEmail(normalizedEmail);
    if (existingEmail) {
        return {
            ok: false,
            status: 409,
            message: "Email or username is already registered",
        };
    }

    const existingUsername =
        await repository.findByUsername(normalizedUsername);
    if (existingUsername) {
        return {
            ok: false,
            status: 409,
            message: "Email or username is already registered",
        };
    }

    const passwordHash = await hashPassword(rawPassword);

    try {
        const user = await repository.createUser({
            username: normalizedUsername,
            name: trimmedName,
            email: normalizedEmail,
            passwordHash,
        });
        return { ok: true, user };
    } catch (err: unknown) {
        if (
            typeof err === "object" &&
            err !== null &&
            (("code" in err && (err as { code: unknown }).code === "23505") ||
                ("number" in err &&
                    (err as { number: unknown }).number === 23505))
        ) {
            return {
                ok: false,
                status: 409,
                message: "Email or username is already registered",
            };
        }
        throw err;
    }
};

export const authenticateEmailUser = async (
    input: unknown,
    repository: EmailAuthRepository = emailAuthRepository
): Promise<EmailAuthResult> => {
    if (!input || typeof input !== "object") {
        return { ok: false, status: 400, message: "Invalid request payload" };
    }
    const payload = input as Record<string, unknown>;
    const { email, password } = payload;

    const emailErr = validateEmailInput(email);
    if (emailErr) return { ok: false, status: 400, message: emailErr };

    const passwordErr = validatePasswordInput(password);
    if (passwordErr) return { ok: false, status: 400, message: passwordErr };

    const rawEmail = email as string;
    const rawPassword = password as string;

    const normalizedEmail = rawEmail.trim().toLowerCase();
    const user = await repository.findByEmail(normalizedEmail);

    if (user && user.passwordHash) {
        const isValid = await verifyPassword(rawPassword, user.passwordHash);
        if (isValid) {
            return { ok: true, user };
        }
    } else {
        await verifyPassword(rawPassword, DUMMY_HASH);
    }

    return {
        ok: false,
        status: 401,
        message: "Invalid email or password",
    };
};
