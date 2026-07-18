import type { Request, Response } from "express";

export const AUTH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const PROD_AUTH_COOKIE = "__Host-reader_session";
export const DEV_AUTH_COOKIE = "reader_session";

export const getAuthCookieName = () =>
    process.env.NODE_ENV === "production" ? PROD_AUTH_COOKIE : DEV_AUTH_COOKIE;

export const parseCookies = (header?: string): Record<string, string> =>
    Object.fromEntries(
        (header ?? "")
            .split(";")
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                const separator = part.indexOf("=");
                if (separator < 0) return [part, ""];

                const name = part.slice(0, separator);
                const value = part.slice(separator + 1);
                try {
                    return [name, decodeURIComponent(value)];
                } catch {
                    return [name, value];
                }
            })
    );

export const getAuthToken = (req: Pick<Request, "headers">) => {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[PROD_AUTH_COOKIE] ?? cookies[DEV_AUTH_COOKIE];
};

const cookieOptions = (secure: boolean) =>
    ({
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
    }) as const;

export const setAuthCookie = (res: Response, token: string) => {
    const production = process.env.NODE_ENV === "production";
    res.cookie(getAuthCookieName(), token, {
        ...cookieOptions(production),
        maxAge: AUTH_COOKIE_MAX_AGE_SECONDS * 1000,
    });
};

export const clearAuthCookies = (res: Response) => {
    res.clearCookie(PROD_AUTH_COOKIE, cookieOptions(true));
    res.clearCookie(DEV_AUTH_COOKIE, cookieOptions(false));
};
