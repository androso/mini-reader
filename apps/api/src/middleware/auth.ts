import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/AuthService";
import { getAuthToken } from "../utils/authCookie";
import { asyncHandler } from "./asyncHandler";

export const readSessionToken = getAuthToken;

export const authenticate = asyncHandler(async function authenticate(
    req: Request,
    res: Response,
    next: NextFunction
) {
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
    next();
});
