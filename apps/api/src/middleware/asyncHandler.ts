import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
) => Promise<unknown>;

export const asyncHandler = (handler: AsyncRequestHandler): RequestHandler =>
    function wrappedAsyncHandler(req, res, next) {
        void Promise.resolve(handler(req, res, next)).catch(next);
    };
