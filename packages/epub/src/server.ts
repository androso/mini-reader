import { JSDOM } from "jsdom";
import type JSZip from "jszip";
import { buildTextBlocksFromDocument } from "./chapterProcessing";
import { processEpubFile } from "./processing";
import {
    findExactManifestEntryByHref,
    normalizeImageMediaType,
    normalizeEpubPackagePath,
    resolveEpubImageResource,
} from "./resourcePath";
import { installDomParser } from "./serverDom";
import { sanitizeEpubSvg } from "./svgSanitizer";
import type { EpubContent } from "./types";
export { buildReaderPackage } from "./readerPackage";
export { installDomParser } from "./serverDom";

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
    buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

export const processEpubBuffer = async (
    buffer: Buffer
): Promise<[EpubContent, JSZip]> => {
    installDomParser();
    return processEpubFile(toArrayBuffer(buffer));
};

export const extractEpubCoverBuffer = async (
    buffer: Buffer
): Promise<{ bytes: Buffer; mediaType: string } | null> => {
    const [content, zip] = await processEpubBuffer(buffer);
    const reference = content.coverReference;
    if (!reference) return null;

    let resolved =
        reference.kind === "image"
            ? (() => {
                  const entry = findExactManifestEntryByHref(
                      content.manifest,
                      reference.href
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
                  return entry && manifestHref && mediaType
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
              })()
            : null;

    if (reference.kind === "document") {
        const documentHref = normalizeEpubPackagePath(
            reference.href.split("#")[0]
        );
        const documentFile = documentHref
            ? zip.file(`${content.basePath}${documentHref}`)
            : null;
        if (documentFile) {
            const coverDom = new JSDOM(await documentFile.async("text"));
            try {
                const image =
                    coverDom.window.document.querySelector("img, image");
                const imageHref =
                    image?.getAttribute("src") ??
                    image?.getAttribute("href") ??
                    image?.getAttribute("xlink:href");
                if (imageHref) {
                    resolved = resolveEpubImageResource(
                        content,
                        documentHref!,
                        imageHref
                    );
                }
            } finally {
                coverDom.window.close();
            }
        }
    }

    if (!resolved) return null;
    const file = zip.file(resolved.zipPath);
    if (!file) return null;
    let bytes: Buffer = Buffer.from(await file.async("uint8array"));
    if (resolved.mediaType === "image/svg+xml") {
        const svgDom = new JSDOM(bytes.toString("utf8"));
        try {
            const sanitized = sanitizeEpubSvg(
                svgDom.window.document.documentElement.outerHTML,
                svgDom.window.document
            );
            if (!sanitized) return null;
            bytes = Buffer.from(sanitized, "utf8");
        } finally {
            svgDom.window.close();
        }
    }
    return { bytes, mediaType: resolved.mediaType };
};

export const extractEpubTextBlocks = async (buffer: Buffer) => {
    const [content, zip] = await processEpubBuffer(buffer);
    const chapters = [];

    for (const id of content.spine) {
        const manifestItem = content.manifest[id];
        if (!manifestItem) continue;

        const file = zip.file(`${content.basePath}${manifestItem.href}`);
        if (!file) continue;

        const chapterHtml = await file.async("text");
        const chapterDom = new JSDOM(chapterHtml);
        try {
            const hrefId = manifestItem.href.includes(".")
                ? manifestItem.href.substring(
                      0,
                      manifestItem.href.lastIndexOf(".")
                  )
                : manifestItem.href;

            chapters.push({
                id,
                hrefId,
                textBlocks: buildTextBlocksFromDocument(
                    chapterDom.window.document,
                    id
                ),
            });
        } finally {
            chapterDom.window.close();
        }
    }

    return { content, chapters };
};
