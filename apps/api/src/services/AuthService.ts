import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { db } from "../db";
import { Users } from "../db/schema";
import { eq } from "drizzle-orm";

if (!process.env.JWT_SECRET) {
    throw new Error("Missing required JWT_SECRET environment variable");
}

if (
    process.env.NODE_ENV === "production" &&
    !process.env.GOOGLE_CLIENT_ID
) {
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
            throw new Error("Google ID token is missing required identity claims");
        }

        return {
            sub: data.sub,
            email: data.email,
            name: data.name ?? data.email,
            picture: data.picture,
        };
    } catch (e) {
        console.error(e);
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
