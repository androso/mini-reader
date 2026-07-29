import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/AuthService";
import { getAuthToken } from "../utils/authCookie";
import { asyncHandler } from "./asyncHandler";
import { verifyMobileAccessToken } from "../services/MobileSessionService";

export const readSessionToken = getAuthToken;

export const readBearerToken = (req: Request): string | null => {
    const authorization = req.get("authorization");
    if (!authorization) return null;
    const match = authorization.match(/^Bearer ([^\s]+)$/);
    return match?.[1] ?? null;
};

export const authenticate = asyncHandler(async function authenticate(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const authorization = req.get("authorization");
    if (authorization) {
        const bearerToken = readBearerToken(req);
        if (!bearerToken) {
            res.status(401).json({ message: "Invalid bearer authorization" });
            return;
        }
        const mobileSession = await verifyMobileAccessToken(bearerToken);
        if (!mobileSession) {
            res.status(401).json({
                message: "Invalid or expired bearer token",
            });
            return;
        }
        req.user = mobileSession.user;
        req.authMethod = "bearer";
        req.mobileSessionId = mobileSession.sessionId;
        next();
        return;
    }

    const token = readSessionToken(req);
    if (!token) {
        res.status(401).json({ message: "No session provided" });
        return;
    }
    const user = await verifyToken(token);
    if (!user) {
        res.status(401).json({ message: "Invalid session" });
        return;
    }

    req.user = user;
    req.authMethod = "cookie";
    next();
});
