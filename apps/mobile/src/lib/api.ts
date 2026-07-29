import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import type { MobileSession } from "@reader/contracts";

const ACCESS_KEY = "mentarie.mobile.access";
const REFRESH_KEY = "mentarie.mobile.refresh";
const SESSION_KEY = "mentarie.mobile.session";

const apiBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let invalidSessionHandler: (() => Promise<void> | void) | null = null;

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        message: string
    ) {
        super(message);
        this.name = "ApiError";
    }
}

export const apiUrl = (path: string) => {
    if (!apiBaseUrl) {
        throw new Error(
            "EXPO_PUBLIC_API_URL is required. Point it at the Reader HTTPS API."
        );
    }
    return `${apiBaseUrl}${path}`;
};

export const registerInvalidSessionHandler = (
    handler: (() => Promise<void> | void) | null
) => {
    invalidSessionHandler = handler;
};

export const currentRefreshToken = () => refreshToken;

export const hydrateStoredSession = async (): Promise<MobileSession | null> => {
    const [storedAccess, storedRefresh, storedSession] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
        SecureStore.getItemAsync(SESSION_KEY),
    ]);
    if (!storedAccess || !storedRefresh || !storedSession) return null;
    try {
        const session = JSON.parse(storedSession) as MobileSession;
        accessToken = storedAccess;
        refreshToken = storedRefresh;
        return {
            ...session,
            accessToken: storedAccess,
            refreshToken: storedRefresh,
        };
    } catch {
        await clearStoredSession();
        return null;
    }
};

export const persistSession = async (session: MobileSession) => {
    accessToken = session.accessToken;
    refreshToken = session.refreshToken;
    await Promise.all([
        SecureStore.setItemAsync(ACCESS_KEY, session.accessToken),
        SecureStore.setItemAsync(REFRESH_KEY, session.refreshToken),
        SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session)),
    ]);
};

export const clearStoredSession = async () => {
    accessToken = null;
    refreshToken = null;
    await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY),
        SecureStore.deleteItemAsync(REFRESH_KEY),
        SecureStore.deleteItemAsync(SESSION_KEY),
    ]);
};

const refreshSession = async () => {
    if (!refreshToken) return false;
    try {
        const response = await expoFetch(apiUrl("/api/auth/mobile/refresh"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
        });
        if (!response.ok) return false;
        await persistSession((await response.json()) as MobileSession);
        return true;
    } catch {
        return false;
    }
};

const refreshOnce = async () => {
    refreshPromise ??= refreshSession().finally(() => {
        refreshPromise = null;
    });
    const refreshed = await refreshPromise;
    if (!refreshed) {
        await clearStoredSession();
        await invalidSessionHandler?.();
    }
    return refreshed;
};

export const authorizedHeaders = (
    headers: HeadersInit = {}
): Record<string, string> => ({
    ...(Object.fromEntries(new Headers(headers).entries()) as Record<
        string,
        string
    >),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
});

export const apiFetch = async (
    path: string,
    init: RequestInit = {},
    retry = true
): Promise<Response> => {
    const response = await expoFetch(apiUrl(path), {
        ...init,
        headers: authorizedHeaders(init.headers),
    });
    if (response.status === 401 && retry && refreshToken) {
        if (await refreshOnce()) return apiFetch(path, init, false);
    }
    return response;
};

export const apiJson = async <T>(
    path: string,
    init: RequestInit = {}
): Promise<T> => {
    const response = await apiFetch(path, {
        ...init,
        headers: {
            ...(init.body instanceof FormData
                ? {}
                : { "Content-Type": "application/json" }),
            ...init.headers,
        },
    });
    if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
            message?: string;
            error?: string;
        };
        throw new ApiError(
            response.status,
            payload.message ??
                payload.error ??
                `The request failed with status ${response.status}`
        );
    }
    return (await response.json()) as T;
};
