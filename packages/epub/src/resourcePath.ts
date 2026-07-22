import type { EpubContent, ManifestItem } from "./types";

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/svg+xml",
]);

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    svg: "image/svg+xml",
};

export type ResolvedEpubImageResource = {
    /** Zip path including package basePath */
    zipPath: string;
    /** Manifest href relative to package basePath */
    manifestHref: string;
    manifestId: string;
    mediaType: string;
};

const stripQueryAndFragment = (value: string): string =>
    value.split(/[?#]/, 1)[0] ?? "";

const decodePathSafely = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

const hasDisallowedProtocol = (value: string): boolean =>
    /^[a-z][a-z0-9+.\-]*:/i.test(value.trim());

/**
 * Normalize an EPUB package-relative path:
 * - strips query/fragment
 * - decodes percent-encoding
 * - collapses . / .. without escaping the package root
 * - rejects absolute protocols and root escapes
 */
export const normalizeEpubPackagePath = (
    path: string | null | undefined
): string | null => {
    if (!path) return null;

    const stripped = stripQueryAndFragment(path).replace(/\\/g, "/").trim();
    if (!stripped || hasDisallowedProtocol(stripped)) return null;

    const decoded = decodePathSafely(stripped).replace(/^\/+/, "");
    const parts: string[] = [];

    for (const part of decoded.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") {
            if (parts.length === 0) return null;
            parts.pop();
            continue;
        }
        parts.push(part);
    }

    return parts.join("/");
};

export const mediaTypeFromPath = (path: string): string | null => {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    return EXTENSION_MEDIA_TYPES[extension] ?? null;
};

export const normalizeImageMediaType = (
    mediaType: string | null | undefined,
    fallbackPath?: string
): string | null => {
    const raw = (mediaType ?? "").trim().toLowerCase();
    const normalized =
        raw === "image/jpg"
            ? "image/jpeg"
            : raw.includes("svg")
              ? "image/svg+xml"
              : raw;

    if (normalized && SUPPORTED_IMAGE_MEDIA_TYPES.has(normalized)) {
        return normalized === "image/jpg" ? "image/jpeg" : normalized;
    }

    if (fallbackPath) {
        const fromPath = mediaTypeFromPath(fallbackPath);
        if (fromPath) return fromPath;
    }

    return null;
};

export const isSupportedImageMediaType = (
    mediaType: string | null | undefined
): boolean => normalizeImageMediaType(mediaType) !== null;

const dirname = (path: string): string => {
    const index = path.lastIndexOf("/");
    return index < 0 ? "" : path.slice(0, index);
};

const joinPackagePaths = (...parts: string[]): string =>
    parts
        .filter(Boolean)
        .join("/")
        .replace(/\/{2,}/g, "/");

/**
 * Resolve an image href relative to the chapter document's package path.
 * `chapterHref` is the OPF manifest href (package-relative).
 */
export const resolveChapterRelativePath = (
    imageHref: string,
    chapterHref: string
): string | null => {
    const imagePath = stripQueryAndFragment(imageHref).trim();
    if (!imagePath || hasDisallowedProtocol(imagePath)) return null;
    if (/^(?:data:|blob:)/i.test(imagePath)) return null;

    const chapterDir = dirname(normalizeEpubPackagePath(chapterHref) ?? "");
    const combined = imagePath.startsWith("/")
        ? imagePath.replace(/^\/+/, "")
        : joinPackagePaths(chapterDir, imagePath);

    return normalizeEpubPackagePath(combined);
};

export const findExactManifestEntryByHref = (
    manifest: Record<string, ManifestItem>,
    packageRelativePath: string
): { id: string; item: ManifestItem } | null => {
    const target = normalizeEpubPackagePath(packageRelativePath);
    if (!target) return null;

    const targetBase = target.split("/").pop() ?? target;

    let basenameMatch: { id: string; item: ManifestItem } | null = null;
    let basenameCollisions = 0;

    for (const [id, item] of Object.entries(manifest)) {
        const href = normalizeEpubPackagePath(item.href);
        if (!href) continue;
        if (href === target) return { id, item };

        const base = href.split("/").pop() ?? href;
        if (base === targetBase) {
            basenameCollisions += 1;
            basenameMatch = { id, item };
        }
    }

    // Allow basename fallback only when unique (no collision).
    if (basenameCollisions === 1) return basenameMatch;
    return null;
};

export const resolveEpubImageResource = (
    epubContent: EpubContent,
    chapterHref: string,
    imageHref: string
): ResolvedEpubImageResource | null => {
    const packagePath = resolveChapterRelativePath(imageHref, chapterHref);
    if (!packagePath) return null;

    const entry = findExactManifestEntryByHref(
        epubContent.manifest,
        packagePath
    );
    if (!entry) return null;

    const mediaType = normalizeImageMediaType(
        entry.item.mediaType,
        entry.item.href
    );
    if (!mediaType) return null;

    const manifestHref = normalizeEpubPackagePath(entry.item.href);
    if (!manifestHref) return null;

    const base = epubContent.basePath.endsWith("/")
        ? epubContent.basePath
        : `${epubContent.basePath}/`;
    return {
        zipPath: `${base}${manifestHref}`.replace(/\/{2,}/g, "/"),
        manifestHref,
        manifestId: entry.id,
        mediaType,
    };
};

export const SUPPORTED_EPUB_IMAGE_MEDIA_TYPES = Object.freeze(
    Array.from(SUPPORTED_IMAGE_MEDIA_TYPES)
);
