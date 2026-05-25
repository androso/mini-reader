import type { EpubContent, ManifestItem, TextBlock } from "../types/EpubReader";

interface NavigableChapter {
    id: string;
    hrefId: string;
    textBlocks?: TextBlock[];
}

export interface ParsedEpubHref {
    path: string;
    fragment: string | null;
}

export const splitEpubHref = (href: string | null | undefined): ParsedEpubHref => {
    if (!href) {
        return { path: "", fragment: null };
    }

    const [pathWithQuery, fragment] = href.split("#", 2);
    return {
        path: pathWithQuery.split("?")[0],
        fragment: fragment || null,
    };
};

export const stripEpubFileExtension = (path: string): string =>
    path.replace(/\.(xhtml|html|htm)$/i, "");

export const normalizeEpubHref = (
    href: string | null | undefined,
    { preserveFragment = false }: { preserveFragment?: boolean } = {}
): string => {
    const { path, fragment } = splitEpubHref(href);
    const decodedPath = (() => {
        try {
            return decodeURIComponent(path);
        } catch {
            return path;
        }
    })();

    const normalizedParts = decodedPath
        .replace(/^\/+/, "")
        .split("/")
        .filter(Boolean)
        .reduce<string[]>((parts, part) => {
            if (part === ".") return parts;
            if (part === "..") {
                parts.pop();
                return parts;
            }
            parts.push(part);
            return parts;
        }, []);

    const normalizedPath = stripEpubFileExtension(normalizedParts.join("/"));
    if (preserveFragment && fragment) {
        return `${normalizedPath}#${fragment}`;
    }

    return normalizedPath;
};

export const getHrefMatchKeys = (href: string | null | undefined) => {
    const normalizedHref = normalizeEpubHref(href);
    const basename = normalizedHref.split("/").pop() ?? "";

    return new Set([normalizedHref, basename].filter(Boolean));
};

export const findManifestEntryByHref = (
    manifest: Record<string, ManifestItem>,
    href: string | null | undefined
): { id: string; item: ManifestItem } | null => {
    const tocKeys = getHrefMatchKeys(href);

    for (const [id, item] of Object.entries(manifest)) {
        const itemKeys = getHrefMatchKeys(item.href);
        if ([...tocKeys].some((key) => itemKeys.has(key))) {
            return { id, item };
        }
    }

    return null;
};

export const resolveTocHrefToSpineId = (
    epubContent: EpubContent,
    href: string | null | undefined
): string | null => {
    const manifestEntry = findManifestEntryByHref(epubContent.manifest, href);
    if (!manifestEntry) return null;

    return epubContent.spine.includes(manifestEntry.id) ? manifestEntry.id : null;
};

export const findChapterByHref = <TChapter extends NavigableChapter>(
    chapters: TChapter[],
    href: string
): TChapter | undefined => {
    const tocKeys = getHrefMatchKeys(href);

    const exactMatch = chapters.find((chapter) =>
        [chapter.hrefId, chapter.id].some((value) =>
            tocKeys.has(normalizeEpubHref(value))
        )
    );

    if (exactMatch) return exactMatch;

    return chapters.find((chapter) =>
        [chapter.hrefId, chapter.id].some((value) => {
            const chapterKeys = getHrefMatchKeys(value);
            return [...tocKeys].some((key) => chapterKeys.has(key));
        })
    );
};
