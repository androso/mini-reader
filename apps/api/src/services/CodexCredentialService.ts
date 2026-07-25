import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type CodexCredentialKind = "access" | "refresh" | "verifier";

const VERSION = "v1";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

export const isCodexOAuthEnabled = () =>
    process.env.CODEX_OAUTH_ENABLED?.toLowerCase() === "true";

const decodeEncryptionKey = (): Buffer => {
    const encoded = process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY;
    if (!encoded) {
        throw new Error(
            "CODEX_CREDENTIAL_ENCRYPTION_KEY is required when CODEX_OAUTH_ENABLED=true"
        );
    }

    const normalized = encoded.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
        throw new Error(
            "CODEX_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
        );
    }

    const key = Buffer.from(normalized, "base64");
    if (key.length !== KEY_LENGTH || key.toString("base64") !== normalized) {
        throw new Error(
            "CODEX_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
        );
    }
    return key;
};

export const validateCodexEnvironment = () => {
    if (!isCodexOAuthEnabled()) return;

    decodeEncryptionKey();
    if (process.env.NODE_ENV === "production") {
        let frontendUrl: URL;
        try {
            frontendUrl = new URL(process.env.FRONTEND_URL || "");
        } catch {
            throw new Error(
                "FRONTEND_URL must be a valid HTTPS URL when Codex OAuth is enabled in production"
            );
        }
        if (frontendUrl.protocol !== "https:") {
            throw new Error(
                "FRONTEND_URL must use HTTPS when Codex OAuth is enabled in production"
            );
        }
    }
};

const aad = (userId: string, kind: CodexCredentialKind) =>
    Buffer.from(`${userId}:${kind}`, "utf8");

export const encryptCredentialSecret = (
    plaintext: string,
    userId: string,
    kind: CodexCredentialKind
): string => {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", decodeEncryptionKey(), iv);
    cipher.setAAD(aad(userId, kind));
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, ciphertext]
        .map((part) =>
            typeof part === "string" ? part : part.toString("base64url")
        )
        .join(".");
};

export const decryptCredentialSecret = (
    serialized: string,
    userId: string,
    kind: CodexCredentialKind
): string => {
    const parts = serialized.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new Error("Unsupported encrypted credential format");
    }

    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_LENGTH || tag.length !== 16) {
        throw new Error("Malformed encrypted credential");
    }

    const decipher = createDecipheriv("aes-256-gcm", decodeEncryptionKey(), iv);
    decipher.setAAD(aad(userId, kind));
    decipher.setAuthTag(tag);
    return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]).toString("utf8");
};
