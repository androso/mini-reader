import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "express";
import {
    AUTH_COOKIE_MAX_AGE_SECONDS,
    clearAuthCookies,
    DEV_AUTH_COOKIE,
    getAuthToken,
    PROD_AUTH_COOKIE,
    setAuthCookie,
} from "../src/utils/authCookie";

type CookieCall = {
    name: string;
    value?: string;
    options: Record<string, unknown>;
};

const setNodeEnv = (value?: string) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
};

const responseRecorder = () => {
    const set: CookieCall[] = [];
    const cleared: CookieCall[] = [];
    const response = {
        cookie(name: string, value: string, options: Record<string, unknown>) {
            set.push({ name, value, options });
            return response;
        },
        clearCookie(name: string, options: Record<string, unknown>) {
            cleared.push({ name, options });
            return response;
        },
    } as unknown as Response;
    return { response, set, cleared };
};

test("production sessions use a secure __Host cookie for seven days", () => {
    const previous = process.env.NODE_ENV;
    setNodeEnv("production");
    try {
        const { response, set } = responseRecorder();
        setAuthCookie(response, "reader-jwt");
        assert.deepEqual(set, [
            {
                name: PROD_AUTH_COOKIE,
                value: "reader-jwt",
                options: {
                    httpOnly: true,
                    secure: true,
                    sameSite: "lax",
                    path: "/",
                    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS * 1000,
                },
            },
        ]);
        assert.equal("domain" in set[0].options, false);
    } finally {
        setNodeEnv(previous);
    }
});

test("development sessions use a non-secure reader_session cookie", () => {
    const previous = process.env.NODE_ENV;
    setNodeEnv("development");
    try {
        const { response, set } = responseRecorder();
        setAuthCookie(response, "reader-jwt");
        assert.equal(set[0].name, DEV_AUTH_COOKIE);
        assert.deepEqual(set[0].options, {
            httpOnly: true,
            secure: false,
            sameSite: "lax",
            path: "/",
            maxAge: AUTH_COOKIE_MAX_AGE_SECONDS * 1000,
        });
    } finally {
        setNodeEnv(previous);
    }
});

test("production authentication accepts only the __Host session cookie", () => {
    const previous = process.env.NODE_ENV;
    setNodeEnv("production");
    try {
        assert.equal(
            getAuthToken({
                headers: {
                    cookie: `${DEV_AUTH_COOKIE}=dev-token; ${PROD_AUTH_COOKIE}=prod%20token`,
                },
            }),
            "prod token"
        );
        assert.equal(
            getAuthToken({
                headers: { cookie: `${DEV_AUTH_COOKIE}=dev-token` },
            }),
            undefined
        );
    } finally {
        setNodeEnv(previous);
    }
});

test("non-production authentication accepts only the development session cookie", () => {
    const previous = process.env.NODE_ENV;
    setNodeEnv("development");
    try {
        assert.equal(
            getAuthToken({
                headers: {
                    cookie: `${PROD_AUTH_COOKIE}=prod-token; ${DEV_AUTH_COOKIE}=dev-token`,
                },
            }),
            "dev-token"
        );
        assert.equal(
            getAuthToken({
                headers: { cookie: `${PROD_AUTH_COOKIE}=prod-token` },
            }),
            undefined
        );
        assert.equal(getAuthToken({ headers: {} }), undefined);
    } finally {
        setNodeEnv(previous);
    }
});

test("logout cookie clearing covers production and development names", () => {
    const { response, cleared } = responseRecorder();
    clearAuthCookies(response);
    assert.deepEqual(cleared, [
        {
            name: PROD_AUTH_COOKIE,
            options: {
                httpOnly: true,
                secure: true,
                sameSite: "lax",
                path: "/",
            },
        },
        {
            name: DEV_AUTH_COOKIE,
            options: {
                httpOnly: true,
                secure: false,
                sameSite: "lax",
                path: "/",
            },
        },
    ]);
});
