import { JSDOM } from "jsdom";
import type JSZip from "jszip";
import { buildTextBlocksFromDocument } from "./chapterProcessing";
import { processEpubFile } from "./processing";
import type { EpubContent } from "./types";

export const installDomParser = () => {
    if (typeof globalThis.DOMParser !== "undefined") return;

    class ServerDOMParser {
        parseFromString(source: string, mimeType: DOMParserSupportedType) {
            const contentType =
                mimeType === "text/html" ? "text/html" : "application/xml";
            return new JSDOM(source, { contentType }).window.document;
        }
    }

    (
        globalThis as typeof globalThis & { DOMParser: typeof DOMParser }
    ).DOMParser = ServerDOMParser as unknown as typeof DOMParser;
};

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

export const extractEpubTextBlocks = async (buffer: Buffer) => {
    const [content, zip] = await processEpubBuffer(buffer);
    const chapters = [];

    for (const id of content.spine) {
        const manifestItem = content.manifest[id];
        if (!manifestItem) continue;

        const file = zip.file(`${content.basePath}${manifestItem.href}`);
        if (!file) continue;

        const doc = new JSDOM(await file.async("text")).window.document;
        const hrefId = manifestItem.href.includes(".")
            ? manifestItem.href.substring(0, manifestItem.href.lastIndexOf("."))
            : manifestItem.href;

        chapters.push({
            id,
            hrefId,
            textBlocks: buildTextBlocksFromDocument(doc, id),
        });
    }

    return { content, chapters };
};
