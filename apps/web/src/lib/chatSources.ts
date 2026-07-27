export type BookContextSource = {
    sourceType: "book";
    id: string;
    chunkIndex: number;
    score: number;
    bestRank: number;
    excerpt: string;
};

export type WebContextSource = {
    sourceType: "web";
    url: string;
    title: string;
};

export type ContextSource = BookContextSource | WebContextSource;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const PRIVATE_IPV4 =
    /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const PRIVATE_IPV6 = /^(?:::1|::|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

export const normalizeAllowedWebUrl = (
    candidate: unknown,
    allowedUrls: ReadonlySet<string>
): string | null => {
    if (
        typeof candidate !== "string" ||
        candidate.length > 2048 ||
        CONTROL_CHARACTER.test(candidate)
    )
        return null;
    try {
        const url = new URL(candidate);
        const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (
            (url.protocol !== "http:" && url.protocol !== "https:") ||
            url.username ||
            url.password
        )
            return null;
        if (
            hostname === "localhost" ||
            hostname.endsWith(".localhost") ||
            hostname.endsWith(".local") ||
            PRIVATE_IPV4.test(hostname) ||
            PRIVATE_IPV6.test(hostname)
        )
            return null;
        const canonical = url.toString();
        return allowedUrls.has(canonical) ? canonical : null;
    } catch {
        return null;
    }
};
