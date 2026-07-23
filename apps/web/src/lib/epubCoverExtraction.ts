import JSZip from "jszip";
import {
    getBasePath,
    normalizeEpubPackagePath,
    normalizeImageMediaType,
} from "@reader/epub";

export type EpubCoverExtractionResult =
    | { status: "cover"; blob: Blob; mediaType: string; path: string }
    | { status: "missing" }
    | { status: "invalid" };

type XmlParser = (source: string, mimeType: DOMParserSupportedType) => Document;

const defaultParseXml: XmlParser = (source, mimeType) =>
    new DOMParser().parseFromString(source, mimeType);

const getLocalName = (element: Element) =>
    (element.localName || element.tagName).toLowerCase();

const propertiesInclude = (
    properties: string | null | undefined,
    token: string
) => (properties ?? "").split(/\s+/).filter(Boolean).includes(token);

const findZipFile = (
    zip: JSZip,
    candidates: Array<string | null | undefined>
) => {
    const files = Object.keys(zip.files).filter(
        (name) => !zip.files[name]?.dir
    );
    const normalizedIndex = new Map<string, string>();

    for (const name of files) {
        const normalized = normalizeEpubPackagePath(name);
        if (normalized && !normalizedIndex.has(normalized)) {
            normalizedIndex.set(normalized, name);
        }
    }

    for (const candidate of candidates) {
        if (!candidate) continue;
        const direct = zip.file(candidate);
        if (direct) return { file: direct, path: candidate };

        const normalized = normalizeEpubPackagePath(candidate);
        if (!normalized) continue;

        const indexed = normalizedIndex.get(normalized);
        if (indexed) {
            const file = zip.file(indexed);
            if (file) return { file, path: indexed };
        }
    }

    return null;
};

const resolvePackagePath = (href: string, basePath: string) => {
    const stripped = href.trim();
    if (!stripped) return null;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(stripped)) return null;

    const relative = stripped.replace(/^\/+/, "");
    const combined = basePath
        ? `${basePath.replace(/\/?$/, "/")}${relative}`
        : relative;

    return normalizeEpubPackagePath(combined);
};

const isImageMediaType = (
    mediaType: string | null | undefined,
    path?: string
) => normalizeImageMediaType(mediaType, path) !== null;

const isHtmlMediaType = (
    mediaType: string | null | undefined,
    path?: string
) => {
    const normalized = (mediaType ?? "").trim().toLowerCase();
    if (
        normalized === "application/xhtml+xml" ||
        normalized === "text/html" ||
        normalized === "application/xml" ||
        normalized === "text/xml"
    ) {
        return true;
    }

    const extension = (path ?? "").split(".").pop()?.toLowerCase();
    return extension === "xhtml" || extension === "html" || extension === "htm";
};

const readManifestItems = (opf: Document) => {
    const items: Array<{
        id: string;
        href: string;
        mediaType: string;
        properties: string | null;
    }> = [];

    for (const item of Array.from(opf.getElementsByTagName("*"))) {
        if (getLocalName(item) !== "item") continue;
        const id = item.getAttribute("id")?.trim();
        const href = item.getAttribute("href")?.trim();
        const mediaType = item.getAttribute("media-type")?.trim();
        if (!id || !href || !mediaType) continue;
        items.push({
            id,
            href,
            mediaType,
            properties: item.getAttribute("properties"),
        });
    }

    return items;
};

type CoverRef =
    | { kind: "image"; href: string }
    | { kind: "guide-html"; href: string }
    | { kind: "invalid" };

const findCoverHrefFromOpf = (opf: Document): CoverRef | null => {
    const items = readManifestItems(opf);

    const epub3Cover = items.find((item) =>
        propertiesInclude(item.properties, "cover-image")
    );
    if (epub3Cover) {
        return isImageMediaType(epub3Cover.mediaType, epub3Cover.href)
            ? { kind: "image", href: epub3Cover.href }
            : { kind: "invalid" };
    }

    let coverId: string | null = null;
    for (const meta of Array.from(opf.getElementsByTagName("*"))) {
        if (getLocalName(meta) !== "meta") continue;
        if (meta.getAttribute("name")?.trim().toLowerCase() !== "cover") {
            continue;
        }
        coverId = meta.getAttribute("content")?.trim() || null;
        if (coverId) break;
    }

    if (coverId) {
        const coverItem = items.find((item) => item.id === coverId);
        if (!coverItem) return { kind: "invalid" };
        return isImageMediaType(coverItem.mediaType, coverItem.href)
            ? { kind: "image", href: coverItem.href }
            : { kind: "invalid" };
    }

    for (const reference of Array.from(opf.getElementsByTagName("*"))) {
        if (getLocalName(reference) !== "reference") continue;
        if (reference.getAttribute("type")?.trim().toLowerCase() !== "cover") {
            continue;
        }
        const href = reference.getAttribute("href")?.trim();
        if (!href) continue;

        const normalizedHref = normalizeEpubPackagePath(href);
        const matchingItem = items.find((item) => {
            const itemHref = normalizeEpubPackagePath(item.href);
            return (
                itemHref === normalizedHref ||
                item.href === href ||
                (itemHref?.split("/").pop() ?? null) ===
                    (normalizedHref?.split("/").pop() ?? null)
            );
        });

        if (matchingItem) {
            if (isImageMediaType(matchingItem.mediaType, matchingItem.href)) {
                return { kind: "image", href: matchingItem.href };
            }
            if (isHtmlMediaType(matchingItem.mediaType, matchingItem.href)) {
                return { kind: "guide-html", href: matchingItem.href };
            }
            return { kind: "invalid" };
        }

        if (isImageMediaType(null, href)) {
            return { kind: "image", href };
        }

        if (isHtmlMediaType(null, href)) {
            return { kind: "guide-html", href };
        }

        return { kind: "invalid" };
    }

    return null;
};

const findImageHrefInDocument = (document: Document): string | null => {
    for (const element of Array.from(document.getElementsByTagName("*"))) {
        const name = getLocalName(element);
        if (name === "img") {
            const src = element.getAttribute("src")?.trim();
            if (src) return src;
        }
        if (name === "image") {
            const href =
                element.getAttribute("href")?.trim() ||
                element.getAttribute("xlink:href")?.trim() ||
                element
                    .getAttributeNS("http://www.w3.org/1999/xlink", "href")
                    ?.trim();
            if (href) return href;
        }
    }
    return null;
};

const extractCoverBlob = async (
    zip: JSZip,
    packagePath: string,
    declaredMediaType?: string | null
): Promise<EpubCoverExtractionResult> => {
    const mediaType = normalizeImageMediaType(declaredMediaType, packagePath);
    if (!mediaType) return { status: "invalid" };

    const match = findZipFile(zip, [packagePath]);
    if (!match) return { status: "missing" };

    const bytes = await match.file.async("arraybuffer");
    return {
        status: "cover",
        blob: new Blob([bytes], { type: mediaType }),
        mediaType,
        path: match.path,
    };
};

export const extractEpubCover = async (
    file: Blob | ArrayBuffer,
    options: { parseXml?: XmlParser } = {}
): Promise<EpubCoverExtractionResult> => {
    const parseXml = options.parseXml ?? defaultParseXml;

    try {
        const data =
            file instanceof ArrayBuffer ? file : await file.arrayBuffer();
        const zip = await JSZip.loadAsync(data);

        const containerFile = findZipFile(zip, ["META-INF/container.xml"]);
        if (!containerFile) return { status: "invalid" };

        const container = parseXml(
            await containerFile.file.async("text"),
            "application/xml"
        );
        const opfPath = normalizeEpubPackagePath(
            container.querySelector("rootfile")?.getAttribute("full-path")
        );
        if (!opfPath) return { status: "invalid" };

        const opfFile = findZipFile(zip, [opfPath]);
        if (!opfFile) return { status: "invalid" };

        const opf = parseXml(
            await opfFile.file.async("text"),
            "application/xml"
        );
        const coverRef = findCoverHrefFromOpf(opf);
        if (!coverRef) return { status: "missing" };
        if (coverRef.kind === "invalid") return { status: "invalid" };

        const basePath = getBasePath(opfPath);

        if (coverRef.kind === "guide-html") {
            const htmlPath = resolvePackagePath(coverRef.href, basePath);
            if (!htmlPath) return { status: "missing" };

            const htmlFile = findZipFile(zip, [
                htmlPath,
                `${basePath}${coverRef.href}`,
            ]);
            if (!htmlFile) return { status: "missing" };

            const htmlDoc = parseXml(
                await htmlFile.file.async("text"),
                "application/xhtml+xml"
            );
            const imageHref = findImageHrefInDocument(htmlDoc);
            if (!imageHref) return { status: "missing" };

            const htmlDir = getBasePath(htmlPath);
            const imagePath = resolvePackagePath(imageHref, htmlDir);
            if (!imagePath) return { status: "invalid" };

            return extractCoverBlob(zip, imagePath);
        }

        const coverPath = resolvePackagePath(coverRef.href, basePath);
        if (!coverPath) return { status: "invalid" };

        const items = readManifestItems(opf);
        const manifestItem = items.find(
            (item) =>
                normalizeEpubPackagePath(item.href) ===
                    normalizeEpubPackagePath(coverRef.href) ||
                item.href === coverRef.href
        );

        return extractCoverBlob(zip, coverPath, manifestItem?.mediaType);
    } catch {
        return { status: "invalid" };
    }
};

export const epubCoverResultToBlob = (
    result: EpubCoverExtractionResult
): Blob | null => (result.status === "cover" ? result.blob : null);
