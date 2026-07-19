import type { NextFunction, Request, RequestHandler, Response } from "express";

const DEFAULT_MAX_ENTRIES = 10_000;

type Bucket = {
    count: number;
    expiresAt: number;
};

export type RateLimitDecision = {
    allowed: boolean;
    retryAfterSeconds: number;
};

export type FixedWindowRateLimiterOptions = {
    limit: number;
    windowMs: number;
    maxEntries?: number;
    now?: () => number;
};

const requirePositiveInteger = (name: string, value: number) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
};

export class FixedWindowRateLimiter {
    private readonly buckets = new Map<string, Bucket>();
    private readonly limit: number;
    private readonly windowMs: number;
    private readonly maxEntries: number;
    private readonly now: () => number;
    private nextExpiry = Number.POSITIVE_INFINITY;

    constructor({
        limit,
        windowMs,
        maxEntries = DEFAULT_MAX_ENTRIES,
        now = Date.now,
    }: FixedWindowRateLimiterOptions) {
        requirePositiveInteger("limit", limit);
        requirePositiveInteger("windowMs", windowMs);
        requirePositiveInteger("maxEntries", maxEntries);
        this.limit = limit;
        this.windowMs = windowMs;
        this.maxEntries = maxEntries;
        this.now = now;
    }

    get size() {
        return this.buckets.size;
    }

    consume(identity: string): RateLimitDecision {
        const now = this.now();
        if (!Number.isFinite(now)) {
            throw new Error("Rate limiter clock must return a finite number");
        }

        this.removeExpired(now);
        const existing = this.buckets.get(identity);
        if (existing) {
            existing.count += 1;
            return this.decision(existing, now);
        }

        if (this.buckets.size >= this.maxEntries) {
            this.evictEarliest();
        }

        const bucket = { count: 1, expiresAt: now + this.windowMs };
        this.buckets.set(identity, bucket);
        this.nextExpiry = Math.min(this.nextExpiry, bucket.expiresAt);
        return this.decision(bucket, now);
    }

    private decision(bucket: Bucket, now: number): RateLimitDecision {
        return {
            allowed: bucket.count <= this.limit,
            retryAfterSeconds: Math.max(
                1,
                Math.ceil((bucket.expiresAt - now) / 1000)
            ),
        };
    }

    private removeExpired(now: number) {
        if (now < this.nextExpiry) return;

        this.nextExpiry = Number.POSITIVE_INFINITY;
        for (const [identity, bucket] of this.buckets) {
            if (bucket.expiresAt <= now) {
                this.buckets.delete(identity);
            } else {
                this.nextExpiry = Math.min(this.nextExpiry, bucket.expiresAt);
            }
        }
    }

    private evictEarliest() {
        let earliestIdentity: string | undefined;
        let earliestExpiry = Number.POSITIVE_INFINITY;
        for (const [identity, bucket] of this.buckets) {
            if (bucket.expiresAt < earliestExpiry) {
                earliestIdentity = identity;
                earliestExpiry = bucket.expiresAt;
            }
        }
        if (earliestIdentity !== undefined) {
            this.buckets.delete(earliestIdentity);
        }
        if (earliestExpiry === this.nextExpiry) this.recomputeNextExpiry();
    }

    private recomputeNextExpiry() {
        this.nextExpiry = Number.POSITIVE_INFINITY;
        for (const bucket of this.buckets.values()) {
            this.nextExpiry = Math.min(this.nextExpiry, bucket.expiresAt);
        }
    }
}

export type RateLimitMiddlewareOptions = FixedWindowRateLimiterOptions & {
    namespace: string;
    identity: (req: Request) => string;
};

export const createRateLimit = ({
    namespace,
    identity,
    ...limiterOptions
}: RateLimitMiddlewareOptions): RequestHandler => {
    const limiter = new FixedWindowRateLimiter(limiterOptions);
    return (req: Request, res: Response, next: NextFunction) => {
        const key = `${namespace}:${identity(req)}`;
        const decision = limiter.consume(key);
        if (decision.allowed) {
            next();
            return;
        }

        res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        res.status(429).json({ error: "Too many requests" });
    };
};

export const authRateLimit = createRateLimit({
    namespace: "auth",
    limit: 20,
    windowMs: 15 * 60 * 1000,
    identity: (req) => req.ip || req.socket.remoteAddress || "unknown-client",
});

export const uploadRateLimit = createRateLimit({
    namespace: "upload",
    limit: 10,
    windowMs: 60 * 60 * 1000,
    identity: (req) => req.user.id,
});

export const chatRateLimit = createRateLimit({
    namespace: "chat",
    limit: 30,
    windowMs: 60 * 1000,
    identity: (req) => req.user.id,
});
