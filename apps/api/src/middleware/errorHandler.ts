import type { ErrorRequestHandler } from "express";

export const terminalErrorHandler: ErrorRequestHandler = (
    error,
    _req,
    res,
    next
) => {
    if (res.headersSent) {
        next(error);
        return;
    }

    console.error("Unhandled request error", error);
    res.status(500).json({ error: "Internal server error" });
};
