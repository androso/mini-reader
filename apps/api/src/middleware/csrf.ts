import type { NextFunction, Request, Response } from "express";
import type { CorsOptions } from "cors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const configuredFrontendOrigin = (): string | undefined => {
    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) return undefined;

    try {
        return new URL(frontendUrl).origin;
    } catch {
        return undefined;
    }
};

export const frontendCorsOptions = (): CorsOptions => {
    const frontendOrigin = configuredFrontendOrigin();
    return {
        origin: (origin, callback) => {
            callback(null, !origin || origin === frontendOrigin);
        },
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
        credentials: true,
    };
};

export const enforceTrustedOrigin = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
        next();
        return;
    }

    const expectedOrigin = configuredFrontendOrigin();
    const suppliedOrigin = req.get("origin");
    let requestOrigin: string | undefined;
    try {
        requestOrigin = suppliedOrigin
            ? new URL(suppliedOrigin).origin
            : undefined;
    } catch {
        requestOrigin = undefined;
    }

    if (
        !expectedOrigin ||
        !suppliedOrigin ||
        requestOrigin !== suppliedOrigin ||
        requestOrigin !== expectedOrigin
    ) {
        res.status(403).json({ message: "Untrusted request origin" });
        return;
    }

    next();
};
