import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { CodexCredentials } from "../db/schema";
import {
    decryptCredentialSecret,
    encryptCredentialSecret,
} from "./CodexCredentialService";

export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_AUTHORIZATION_URL =
    "https://auth.openai.com/oauth/authorize";
export const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const CODEX_SCOPE = "openid profile email offline_access";
export const CODEX_MODELS = [
    "gpt-5.6",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
] as const;
export type CodexModel = (typeof CODEX_MODELS)[number];
export const CODEX_MODEL: CodexModel = "gpt-5.6-luna";
export const isCodexModel = (model: unknown): model is CodexModel =>
    typeof model === "string" &&
    (CODEX_MODELS as readonly string[]).includes(model);

const PENDING_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000;
const TOKEN_TIMEOUT_MS = 30 * 1000;
const MAX_TOKEN_RESPONSE_BYTES = 1024 * 1024;

export class CodexOAuthError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly retryable = false
    ) {
        super(message);
        this.name = "CodexOAuthError";
    }
}

type TokenResponse = {
    id_token: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
};

type AccountMetadata = {
    accountId: string;
    email: string | null;
    planType: string | null;
};

const base64url = (value: Buffer) => value.toString("base64url");

const readBoundedJson = async (response: Response): Promise<unknown> => {
    const contentLength = Number(response.headers.get("content-length"));
    if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_TOKEN_RESPONSE_BYTES
    ) {
        throw new CodexOAuthError(
            "Codex token response was too large",
            502,
            true
        );
    }
    if (!response.body) {
        throw new CodexOAuthError("Codex token response was empty", 502, true);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_TOKEN_RESPONSE_BYTES) {
            await reader.cancel();
            throw new CodexOAuthError(
                "Codex token response was too large",
                502,
                true
            );
        }
        chunks.push(value);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new CodexOAuthError(
            "Codex token response was invalid",
            502,
            true
        );
    }
};

const requireTokenResponse = (value: unknown): TokenResponse => {
    const candidate = value as Partial<TokenResponse> | null;
    if (
        !candidate ||
        typeof candidate.id_token !== "string" ||
        !candidate.id_token ||
        typeof candidate.access_token !== "string" ||
        !candidate.access_token ||
        typeof candidate.refresh_token !== "string" ||
        !candidate.refresh_token ||
        typeof candidate.expires_in !== "number" ||
        !Number.isFinite(candidate.expires_in) ||
        candidate.expires_in <= 0
    ) {
        throw new CodexOAuthError("Codex token response was incomplete", 502);
    }
    return candidate as TokenResponse;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

export const decodeCodexAccountMetadata = (
    idToken: string
): AccountMetadata => {
    const segments = idToken.split(".");
    if (segments.length !== 3 || segments.some((segment) => !segment)) {
        throw new CodexOAuthError("Codex ID token was invalid", 502);
    }

    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(
            Buffer.from(segments[1], "base64url").toString("utf8")
        ) as Record<string, unknown>;
    } catch {
        throw new CodexOAuthError("Codex ID token was invalid", 502);
    }

    const auth = asRecord(payload["https://api.openai.com/auth"]);
    const profile = asRecord(payload["https://api.openai.com/profile"]);
    const accountId =
        auth?.chatgpt_account_id ??
        payload["https://api.openai.com/auth.chatgpt_account_id"];
    if (typeof accountId !== "string" || !accountId) {
        throw new CodexOAuthError(
            "Codex ID token did not identify an account",
            502
        );
    }
    const planType = auth?.chatgpt_plan_type ?? payload.chatgpt_plan_type;
    const email =
        payload.email ??
        profile?.email ??
        payload["https://api.openai.com/profile.email"];
    return {
        accountId,
        planType: typeof planType === "string" ? planType : null,
        email: typeof email === "string" ? email : null,
    };
};

const parseRedirect = (redirectUrl: string) => {
    let parsed: URL;
    try {
        parsed = new URL(redirectUrl);
    } catch {
        throw new CodexOAuthError("Invalid Codex callback URL", 400);
    }
    if (
        parsed.origin !== "http://localhost:1455" ||
        parsed.pathname !== "/auth/callback" ||
        parsed.username ||
        parsed.password ||
        parsed.hash
    ) {
        throw new CodexOAuthError("Invalid Codex callback URL", 400);
    }
    const codes = parsed.searchParams.getAll("code");
    const states = parsed.searchParams.getAll("state");
    if (codes.length !== 1 || !codes[0] || states.length !== 1 || !states[0]) {
        throw new CodexOAuthError("Invalid Codex callback URL", 400);
    }
    return { code: codes[0], state: states[0] };
};

export const buildCodexAuthorizationUrl = (verifier: string, state: string) => {
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const authorizationUrl = new URL(CODEX_AUTHORIZATION_URL);
    authorizationUrl.search = new URLSearchParams({
        response_type: "code",
        client_id: CODEX_CLIENT_ID,
        redirect_uri: CODEX_REDIRECT_URI,
        scope: CODEX_SCOPE,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        originator: "reader-monorepo",
    }).toString();
    return authorizationUrl.toString();
};

export class CodexOAuthService {
    constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    async startAuthorization(userId: string) {
        const verifier = base64url(randomBytes(32));
        const state = base64url(randomBytes(16));
        const authorizationUrl = buildCodexAuthorizationUrl(verifier, state);
        const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

        await db
            .insert(CodexCredentials)
            .values({
                userId,
                pendingState: state,
                pendingVerifierEncrypted: encryptCredentialSecret(
                    verifier,
                    userId,
                    "verifier"
                ),
                pendingExpiresAt: expiresAt,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: CodexCredentials.userId,
                set: {
                    pendingState: state,
                    pendingVerifierEncrypted: encryptCredentialSecret(
                        verifier,
                        userId,
                        "verifier"
                    ),
                    pendingExpiresAt: expiresAt,
                    updatedAt: new Date(),
                },
            });

        return { authorizationUrl, expiresAt };
    }

    async completeAuthorization(userId: string, redirectUrl: string) {
        const callback = parseRedirect(redirectUrl);
        const [pending] = await db
            .select()
            .from(CodexCredentials)
            .where(eq(CodexCredentials.userId, userId))
            .limit(1);
        if (
            !pending?.pendingState ||
            !pending.pendingVerifierEncrypted ||
            !pending.pendingExpiresAt
        ) {
            throw new CodexOAuthError("No pending Codex authorization", 400);
        }
        if (pending.pendingExpiresAt.getTime() <= Date.now()) {
            await this.clearPending(userId);
            throw new CodexOAuthError("Codex authorization expired", 400);
        }
        if (callback.state !== pending.pendingState) {
            throw new CodexOAuthError(
                "Codex authorization state mismatch",
                400
            );
        }

        const verifier = decryptCredentialSecret(
            pending.pendingVerifierEncrypted,
            userId,
            "verifier"
        );
        const tokens = await this.requestTokens(
            new URLSearchParams({
                grant_type: "authorization_code",
                client_id: CODEX_CLIENT_ID,
                code: callback.code,
                code_verifier: verifier,
                redirect_uri: CODEX_REDIRECT_URI,
            })
        );
        const metadata = decodeCodexAccountMetadata(tokens.id_token);
        await this.storeTokens(userId, tokens, metadata);
        return metadata;
    }

    async getValidAccessToken(userId: string): Promise<{
        accessToken: string;
        accountId: string;
    }> {
        const result = await db.transaction(async (tx) => {
            await tx.execute(
                sql`select ${CodexCredentials.userId} from ${CodexCredentials} where ${CodexCredentials.userId} = ${userId} for update`
            );
            const [credential] = await tx
                .select()
                .from(CodexCredentials)
                .where(eq(CodexCredentials.userId, userId))
                .limit(1);
            if (
                !credential?.accessTokenEncrypted ||
                !credential.refreshTokenEncrypted ||
                !credential.accountId ||
                !credential.tokenExpiresAt ||
                credential.reauthRequired
            ) {
                throw new CodexOAuthError(
                    "Codex account must be connected",
                    409
                );
            }
            if (
                credential.tokenExpiresAt.getTime() >
                Date.now() + REFRESH_MARGIN_MS
            ) {
                return {
                    accessToken: decryptCredentialSecret(
                        credential.accessTokenEncrypted,
                        userId,
                        "access"
                    ),
                    accountId: credential.accountId,
                };
            }

            const refreshToken = decryptCredentialSecret(
                credential.refreshTokenEncrypted,
                userId,
                "refresh"
            );
            let tokens: TokenResponse;
            try {
                tokens = await this.requestTokens(
                    new URLSearchParams({
                        grant_type: "refresh_token",
                        refresh_token: refreshToken,
                        client_id: CODEX_CLIENT_ID,
                    })
                );
            } catch (error) {
                if (
                    error instanceof CodexOAuthError &&
                    !error.retryable &&
                    [400, 401].includes(error.status)
                ) {
                    await tx
                        .update(CodexCredentials)
                        .set({
                            accessTokenEncrypted: null,
                            refreshTokenEncrypted: null,
                            tokenExpiresAt: null,
                            reauthRequired: true,
                            updatedAt: new Date(),
                        })
                        .where(eq(CodexCredentials.userId, userId));
                    return { error };
                }
                throw error;
            }
            const metadata = decodeCodexAccountMetadata(tokens.id_token);
            const tokenExpiresAt = new Date(
                Date.now() + tokens.expires_in * 1000
            );
            await tx
                .update(CodexCredentials)
                .set({
                    accessTokenEncrypted: encryptCredentialSecret(
                        tokens.access_token,
                        userId,
                        "access"
                    ),
                    refreshTokenEncrypted: encryptCredentialSecret(
                        tokens.refresh_token,
                        userId,
                        "refresh"
                    ),
                    accountId: metadata.accountId,
                    email: metadata.email,
                    planType: metadata.planType,
                    tokenExpiresAt,
                    reauthRequired: false,
                    updatedAt: new Date(),
                })
                .where(eq(CodexCredentials.userId, userId));
            return {
                accessToken: tokens.access_token,
                accountId: metadata.accountId,
            };
        });
        if ("error" in result) throw result.error;
        return result;
    }

    async hasUsableCredentials(userId: string) {
        const [credential] = await db
            .select({ userId: CodexCredentials.userId })
            .from(CodexCredentials)
            .where(
                and(
                    eq(CodexCredentials.userId, userId),
                    eq(CodexCredentials.reauthRequired, false),
                    isNotNull(CodexCredentials.accessTokenEncrypted),
                    isNotNull(CodexCredentials.refreshTokenEncrypted),
                    isNotNull(CodexCredentials.accountId)
                )
            )
            .limit(1);
        return Boolean(credential);
    }

    private async clearPending(userId: string) {
        await db
            .update(CodexCredentials)
            .set({
                pendingState: null,
                pendingVerifierEncrypted: null,
                pendingExpiresAt: null,
                updatedAt: new Date(),
            })
            .where(eq(CodexCredentials.userId, userId));
    }

    private async storeTokens(
        userId: string,
        tokens: TokenResponse,
        metadata: AccountMetadata
    ) {
        await db
            .update(CodexCredentials)
            .set({
                accessTokenEncrypted: encryptCredentialSecret(
                    tokens.access_token,
                    userId,
                    "access"
                ),
                refreshTokenEncrypted: encryptCredentialSecret(
                    tokens.refresh_token,
                    userId,
                    "refresh"
                ),
                accountId: metadata.accountId,
                email: metadata.email,
                planType: metadata.planType,
                tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
                connectedAt: new Date(),
                pendingState: null,
                pendingVerifierEncrypted: null,
                pendingExpiresAt: null,
                reauthRequired: false,
                updatedAt: new Date(),
            })
            .where(eq(CodexCredentials.userId, userId));
    }

    private async requestTokens(form: URLSearchParams): Promise<TokenResponse> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
        let response: Response;
        try {
            response = await this.fetchImpl(CODEX_TOKEN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept-Encoding": "identity",
                },
                body: form,
                redirect: "error",
                signal: controller.signal,
            });
        } catch (error) {
            throw new CodexOAuthError(
                error instanceof Error && error.name === "AbortError"
                    ? "Codex token request timed out"
                    : "Codex token request failed",
                503,
                true
            );
        } finally {
            clearTimeout(timeout);
        }

        const body = await readBoundedJson(response);
        if (!response.ok) {
            const code = (body as { error?: unknown } | null)?.error;
            const permanent =
                response.status === 400 ||
                response.status === 401 ||
                code === "invalid_grant";
            throw new CodexOAuthError(
                permanent
                    ? "Codex authorization is no longer valid"
                    : "Codex token service is unavailable",
                response.status,
                !permanent
            );
        }
        return requireTokenResponse(body);
    }
}
