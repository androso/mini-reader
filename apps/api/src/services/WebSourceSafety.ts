import type { WebMessageContextSource } from "../db/schema";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const PRIVATE_IPV4 =
    /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const PRIVATE_IPV6 = /^(?:::1|::|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

export const normalizePublicWebUrl = (value: unknown): string | null => {
    if (
        typeof value !== "string" ||
        value.length > 2048 ||
        CONTROL_CHARACTER.test(value)
    )
        return null;
    try {
        const url = new URL(value);
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
            hostname.endsWith(".local")
        )
            return null;
        if (PRIVATE_IPV4.test(hostname) || PRIVATE_IPV6.test(hostname))
            return null;
        return url.toString();
    } catch {
        return null;
    }
};

export const normalizeWebSourceTitle = (
    value: unknown,
    url: string
): string => {
    const text =
        typeof value === "string"
            ? value.replace(CONTROL_CHARACTER, " ").trim().slice(0, 200)
            : "";
    return text || new URL(url).hostname;
};

type Citation = {
    type?: unknown;
    url?: unknown;
    title?: unknown;
    start_index?: unknown;
    end_index?: unknown;
};

export const formatCitedWebAnswer = (
    content: string,
    annotations: unknown
): { content: string; sources: WebMessageContextSource[] } | null => {
    if (!content.trim() || !Array.isArray(annotations)) return null;
    const sources: WebMessageContextSource[] = [];
    const sourceNumbers = new Map<string, number>();
    const insertions: Array<{ offset: number; text: string }> = [];
    for (const raw of annotations) {
        if (!raw || typeof raw !== "object") continue;
        const citation = raw as Citation;
        if (citation.type !== "url_citation") continue;
        const url = normalizePublicWebUrl(citation.url);
        if (!url) continue;
        let number = sourceNumbers.get(url);
        if (!number) {
            number = sources.length + 1;
            sourceNumbers.set(url, number);
            sources.push({
                sourceType: "web",
                url,
                title: normalizeWebSourceTitle(citation.title, url),
            });
        }
        if (
            typeof citation.end_index === "number" &&
            Number.isInteger(citation.end_index) &&
            citation.end_index >= 0 &&
            citation.end_index <= content.length
        ) {
            insertions.push({
                offset: citation.end_index,
                text: ` [${number}](<${url}>)`,
            });
        }
    }
    if (!sources.length || !insertions.length) return null;
    let cited = content;
    for (const insertion of insertions.sort((a, b) => b.offset - a.offset)) {
        cited = `${cited.slice(0, insertion.offset)}${insertion.text}${cited.slice(insertion.offset)}`;
    }
    return { content: cited, sources };
};
