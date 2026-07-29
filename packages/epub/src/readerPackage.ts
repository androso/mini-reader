import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import {
    buildTextBlocksFromDocument,
    markChapterImagesForLazyLoad,
} from "./chapterProcessing";
import {
    findExactManifestEntryByHref,
    normalizeImageMediaType,
    normalizeEpubPackagePath,
    resolveEpubImageResource,
} from "./resourcePath";
import { processEpubFile } from "./processing";
import { resolveTocHrefToSpineId } from "./navigation";
import { installDomParser } from "./serverDom";
import { sanitizeEpubSvg } from "./svgSanitizer";
import type {
    EpubContent,
    ReaderPackage,
    ReaderPackageChapter,
    ReaderPackageResource,
} from "./types";

const resourceId = (value: string) =>
    createHash("sha256").update(value).digest("hex").slice(0, 32);

const chapterTitle = (
    content: EpubContent,
    href: string,
    fallback: string | null
) => {
    const normalizedHref = normalizeEpubPackagePath(href);
    const tocEntry = content.toc.find((entry) => {
        const tocHref = normalizeEpubPackagePath(
            (entry.href ?? "").split("#")[0]
        );
        return tocHref === normalizedHref;
    });
    return tocEntry?.title?.trim() || fallback;
};

export const buildReaderPackage = async (
    buffer: Buffer
): Promise<ReaderPackage> => {
    installDomParser();
    const epubData = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    const [content, zip] = await processEpubFile(epubData);
    const resources = new Map<string, ReaderPackageResource>();
    const chapters: ReaderPackageChapter[] = [];
    const hrefToChapter = new Map<string, string>();

    const coverManifestEntry = Object.entries(content.manifest).find(
        ([id, item]) =>
            item.properties?.split(/\s+/).includes("cover-image") ||
            /^cover(?:-image)?$/i.test(id)
    );
    const coverHref = coverManifestEntry
        ? normalizeEpubPackagePath(coverManifestEntry[1].href)
        : null;

    for (const [order, chapterId] of content.spine.entries()) {
        const manifestItem = content.manifest[chapterId];
        if (!manifestItem) continue;
        const href = normalizeEpubPackagePath(manifestItem.href);
        if (!href) continue;
        const file = zip.file(`${content.basePath}${href}`);
        if (!file) continue;

        const chapterDom = new JSDOM(await file.async("text"));
        try {
            const doc = chapterDom.window.document;
            markChapterImagesForLazyLoad(doc, (src) =>
                resolveEpubImageResource(content, href, src)
            );

            for (const image of Array.from(doc.querySelectorAll("img"))) {
                const archiveHref = image.getAttribute("data-epub-src");
                const inlineSvg = image.getAttribute("data-epub-svg");
                if (archiveHref) {
                    const entry = findExactManifestEntryByHref(
                        content.manifest,
                        archiveHref
                    );
                    const manifestHref = entry
                        ? normalizeEpubPackagePath(entry.item.href)
                        : null;
                    const mediaType = entry
                        ? normalizeImageMediaType(
                              entry.item.mediaType,
                              entry.item.href
                          )
                        : null;
                    const resolved =
                        entry && manifestHref && mediaType
                            ? {
                                  manifestHref,
                                  mediaType,
                                  zipPath:
                                      `${content.basePath}${manifestHref}`.replace(
                                          /\/{2,}/g,
                                          "/"
                                      ),
                              }
                            : null;
                    if (!resolved) {
                        image.remove();
                        continue;
                    }
                    const id = resourceId(resolved.manifestHref);
                    if (!resources.has(id)) {
                        const archiveResource = zip.file(resolved.zipPath);
                        if (!archiveResource) {
                            image.remove();
                            continue;
                        }
                        let bytes = await archiveResource.async("uint8array");
                        if (resolved.mediaType === "image/svg+xml") {
                            const svgDom = new JSDOM(
                                Buffer.from(bytes).toString("utf8")
                            );
                            try {
                                const sanitized = sanitizeEpubSvg(
                                    svgDom.window.document.documentElement
                                        .outerHTML,
                                    svgDom.window.document
                                );
                                if (!sanitized) {
                                    image.remove();
                                    continue;
                                }
                                bytes = Buffer.from(sanitized, "utf8");
                            } finally {
                                svgDom.window.close();
                            }
                        }
                        resources.set(id, {
                            id,
                            mediaType: resolved.mediaType,
                            bytes,
                            isCover:
                                normalizeEpubPackagePath(
                                    resolved.manifestHref
                                ) === coverHref,
                        });
                    }
                    image.setAttribute("data-reader-resource-id", id);
                } else if (inlineSvg) {
                    const id = resourceId(`inline:${inlineSvg}`);
                    if (!resources.has(id)) {
                        resources.set(id, {
                            id,
                            mediaType: "image/svg+xml",
                            bytes: Buffer.from(inlineSvg, "utf8"),
                            isCover: false,
                        });
                    }
                    image.setAttribute("data-reader-resource-id", id);
                }
                image.removeAttribute("data-epub-src");
                image.removeAttribute("data-epub-mime");
                image.removeAttribute("data-epub-svg");
                image.removeAttribute("src");
            }

            const blocks = buildTextBlocksFromDocument(doc, chapterId).map(
                (block) => ({
                    id: block.id,
                    html: block.content,
                    text: block.text,
                })
            );
            const heading =
                doc.querySelector("h1,h2,h3")?.textContent?.trim() || null;
            chapters.push({
                id: chapterId,
                title: chapterTitle(content, href, heading),
                href,
                order,
                blocks,
            });
            hrefToChapter.set(href, chapterId);
        } finally {
            chapterDom.window.close();
        }
    }

    const toc = content.toc.map((entry) => {
        const [tocPath, fragment] = (entry.href ?? "").split("#", 2);
        const normalizedPath = normalizeEpubPackagePath(tocPath);
        const chapterId =
            (normalizedPath ? hrefToChapter.get(normalizedPath) : null) ??
            resolveTocHrefToSpineId(content, entry.href ?? "") ??
            null;
        return {
            title: entry.title,
            level: entry.level,
            chapterId,
            blockId:
                chapterId && fragment
                    ? `${chapterId}-block-${Math.max(
                          0,
                          chapters
                              .find((chapter) => chapter.id === chapterId)
                              ?.blocks.findIndex((block) =>
                                  block.html.includes(`id="${fragment}"`)
                              ) ?? 0
                      )}`
                    : null,
        };
    });
    const resourceList = Array.from(resources.values());
    return {
        metadata: content.metadata,
        chapters,
        toc,
        resources: resourceList,
        coverResourceId:
            resourceList.find((resource) => resource.isCover)?.id ?? null,
    };
};
