import type { ErrorRequestHandler } from "express";

const PARSER_ERROR_STATUSES = new Map<string, number>([
    ["encoding.unsupported", 415],
    ["entity.parse.failed", 400],
    ["entity.verify.failed", 403],
    ["request.aborted", 400],
    ["request.size.invalid", 400],
    ["entity.too.large", 413],
    ["parameters.too.many", 413],
    ["charset.unsupported", 415],
]);

const parserErrorStatus = (error: unknown): number | undefined => {
    if (!error || typeof error !== "object") return undefined;

    const candidate = error as {
        status?: unknown;
        statusCode?: unknown;
        type?: unknown;
    };
    if (typeof candidate.type !== "string") return undefined;

    const status = candidate.status ?? candidate.statusCode;
    const expectedStatus = PARSER_ERROR_STATUSES.get(candidate.type);
    if (
        typeof status !== "number" ||
        !Number.isInteger(status) ||
        status !== expectedStatus
    ) {
        return undefined;
    }

    return status;
};

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

    const status = parserErrorStatus(error);
    if (status) {
        res.status(status).json({ error: "Invalid request" });
        return;
    }

    console.error("Unhandled request error", error);
    res.status(500).json({ error: "Internal server error" });
};
