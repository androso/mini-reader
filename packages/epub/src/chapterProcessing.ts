import createDOMPurify from "dompurify";
import type { TextBlock } from "./types";
import {
    isSupportedImageMediaType,
    type ResolvedEpubImageResource,
} from "./resourcePath";
import { sanitizeEpubSvg } from "./svgSanitizer";

const ALLOWED_HTML_TAGS = [
    "a",
    "abbr",
    "article",
    "aside",
    "b",
    "blockquote",
    "br",
    "caption",
    "cite",
    "code",
    "dd",
    "del",
    "dfn",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "i",
    "img",
    "ins",
    "li",
    "main",
    "mark",
    "ol",
    "p",
    "pre",
    "q",
    "s",
    "section",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
].sort();

const ALLOWED_HTML_ATTRIBUTES = [
    "alt",
    "aria-label",
    "aria-labelledby",
    "class",
    "colspan",
    "decoding",
    "height",
    "href",
    "id",
    "lang",
    "loading",
    "name",
    "rel",
    "role",
    "rowspan",
    "src",
    "title",
    "width",
    // Internal lazy-hydration markers (also listed in ADD_ATTR).
    "data-epub-src",
    "data-epub-mime",
    "data-epub-svg",
].sort();

const EPUB_IMAGE_MARKER_ATTRS = [
    "data-epub-src",
    "data-epub-mime",
    "data-epub-svg",
] as const;

const SAFE_URL_PATTERN =
    /^(?:(?:https?|mailto|tel|blob):|data:image\/(?:png|gif|jpe?g|webp|svg\+xml);|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
const SAFE_IMAGE_DATA_URL_PATTERN =
    /^data:image\/(?:png|gif|jpe?g|webp);(?:base64,|charset=[^;,]+;base64,)/i;
const SAFE_ABSOLUTE_PROTOCOLS = new Set([
    "blob:",
    "http:",
    "https:",
    "mailto:",
    "tel:",
]);

const FORBIDDEN_HTML_TAGS = [
    "annotation-xml",
    "canvas",
    "embed",
    "foreignObject",
    "iframe",
    "math",
    "mtext",
    "noembed",
    "noframes",
    "noscript",
    "object",
    "script",
    "style",
    "svg",
    "template",
];

const READABLE_BLOCK_SELECTOR = [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "li",
    "dt",
    "dd",
    "figure",
    "figcaption",
    "caption",
    "th",
    "td",
].join(",");

const CONTAINER_SELECTOR = [
    "body",
    "main",
    "article",
    "section",
    "div",
    "aside",
    "header",
    "footer",
].join(",");

const SKIPPED_SELECTOR = ["link", "meta", "title", ...FORBIDDEN_HTML_TAGS].join(
    ","
);

const getPurifierWindow = (doc: Document) => {
    if (doc.defaultView) return doc.defaultView;
    if (typeof window !== "undefined") return window;
    throw new Error("A DOM window is required to sanitize EPUB HTML");
};

const isSafeRasterDataUrl = (value: string): boolean =>
    SAFE_IMAGE_DATA_URL_PATTERN.test(
        value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "")
    );

const isSafeUrlAttribute = (
    element: Element,
    attribute: "href" | "src",
    value: string
): boolean => {
    const normalized = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
    if (/^data:/i.test(normalized)) {
        return (
            element.tagName.toLowerCase() === "img" &&
            attribute === "src" &&
            isSafeRasterDataUrl(normalized)
        );
    }

    const protocol = normalized.match(/^[a-z][a-z0-9+.\-]*:/i)?.[0];
    if (!protocol) return true;

    // Images never load remote HTTP(S); anchors may still link out.
    if (element.tagName.toLowerCase() === "img" && attribute === "src") {
        return protocol.toLowerCase() === "blob:";
    }

    return SAFE_ABSOLUTE_PROTOCOLS.has(protocol.toLowerCase());
};

export const sanitizeEpubHtml = (html: string, doc: Document): string => {
    const purify = createDOMPurify(getPurifierWindow(doc));
    const template = doc.createElement("template");
    template.innerHTML = html;
    // XHTML outerHTML includes xmlns=... which can make DOMPurify drop the
    // element; strip namespace attrs before sanitizing.
    template.content.querySelectorAll("*").forEach((element) => {
        for (const attr of Array.from(element.attributes)) {
            if (
                attr.name === "xmlns" ||
                attr.name.startsWith("xmlns:") ||
                attr.name.startsWith("xml:")
            ) {
                element.removeAttribute(attr.name);
            }
        }
    });
    template.content
        .querySelectorAll(FORBIDDEN_HTML_TAGS.join(","))
        .forEach((element) => element.remove());

    const sanitized = purify.sanitize(template.innerHTML, {
        ALLOW_ARIA_ATTR: true,
        ALLOW_DATA_ATTR: false,
        ALLOW_UNKNOWN_PROTOCOLS: false,
        ALLOWED_ATTR: ALLOWED_HTML_ATTRIBUTES,
        ALLOWED_TAGS: ALLOWED_HTML_TAGS,
        ALLOWED_URI_REGEXP: SAFE_URL_PATTERN,
        ADD_ATTR: [...EPUB_IMAGE_MARKER_ATTRS, "loading", "decoding"],
        FORBID_ATTR: ["style"],
        FORBID_TAGS: FORBIDDEN_HTML_TAGS,
    });

    template.innerHTML = sanitized;
    template.content.querySelectorAll("[href],[src]").forEach((element) => {
        for (const attribute of ["href", "src"] as const) {
            const value = element.getAttribute(attribute);
            if (value && !isSafeUrlAttribute(element, attribute, value)) {
                element.removeAttribute(attribute);
            }
        }
    });

    // Drop marker attributes from non-img elements if they somehow appear.
    template.content.querySelectorAll("*").forEach((element) => {
        if (element.tagName.toLowerCase() === "img") return;
        for (const attr of EPUB_IMAGE_MARKER_ATTRS) {
            element.removeAttribute(attr);
        }
    });

    return template.innerHTML;
};

const hasRenderableContent = (element: Element): boolean => {
    const hasText = Boolean(element.textContent?.replace(/\s+/g, " ").trim());
    const hasMedia = Boolean(
        element.matches("img") ||
            element.querySelector("img,svg,math,table,figure,canvas")
    );

    return hasText || hasMedia;
};

const hasNestedReadableBlock = (element: Element): boolean =>
    Boolean(element.querySelector(READABLE_BLOCK_SELECTOR));

const hasRenderableHtml = (html: string, doc: Document): boolean => {
    const blockElement = doc.createElement("div");
    blockElement.innerHTML = html;
    const hasText = Boolean(
        blockElement.textContent?.replace(/\s+/g, " ").trim()
    );
    const hasVisibleElement = Boolean(blockElement.querySelector("img,hr"));
    return hasText || hasVisibleElement;
};

const isStandaloneImage = (element: Element): boolean =>
    element.tagName.toLowerCase() === "img" &&
    Boolean(
        element.getAttribute("src") ||
            element.getAttribute("data-epub-src") ||
            element.getAttribute("data-epub-svg")
    );

const collectReadableBlocks = (element: Element): Element[] => {
    if (element.matches(SKIPPED_SELECTOR)) {
        return [];
    }

    if (isStandaloneImage(element)) {
        return [element];
    }

    if (!hasRenderableContent(element)) {
        return [];
    }

    // Keep figures intact so captions stay attached to their image.
    if (element.tagName.toLowerCase() === "figure") {
        return [element];
    }

    if (element.matches(READABLE_BLOCK_SELECTOR)) {
        return [element];
    }

    const childBlocks = Array.from(element.children).flatMap((child) =>
        collectReadableBlocks(child)
    );
    if (childBlocks.length > 0) {
        return childBlocks;
    }

    if (
        element.matches(CONTAINER_SELECTOR) ||
        !hasNestedReadableBlock(element)
    ) {
        return [element];
    }

    return [];
};

export const getReadableBlockElements = (doc: Document): Element[] =>
    Array.from(doc.body.children).flatMap((child) =>
        collectReadableBlocks(child)
    );

export const buildTextBlocksFromDocument = (
    doc: Document,
    chapterId: string
): TextBlock[] =>
    getReadableBlockElements(doc)
        .map<TextBlock | null>((element, index) => {
            const content = sanitizeEpubHtml(element.outerHTML, doc);
            if (!hasRenderableHtml(content, doc)) return null;

            const blockElement = doc.createElement("div");
            blockElement.innerHTML = content;

            return {
                id: `${chapterId}-block-${index}`,
                content,
                text: blockElement.textContent ?? "",
            };
        })
        .filter((block): block is TextBlock => block !== null);

const applyImageMarker = (
    img: HTMLImageElement,
    resource: ResolvedEpubImageResource
) => {
    img.removeAttribute("src");
    img.setAttribute("data-epub-src", resource.manifestHref);
    img.setAttribute("data-epub-mime", resource.mediaType);
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    if (!img.getAttribute("alt")) {
        img.setAttribute("alt", "");
    }
};

/**
 * Replace archive image sources (and inline SVGs) with lazy-hydration markers.
 * Does not read zip bytes — hydration happens later near the viewport.
 */
export const markChapterImagesForLazyLoad = (
    doc: Document,
    resolveResource: (src: string) => ResolvedEpubImageResource | null
): void => {
    for (const img of Array.from(doc.querySelectorAll("img"))) {
        const src = img.getAttribute("src")?.trim() ?? "";
        if (!src) {
            // Keep existing markers if present.
            if (
                img.getAttribute("data-epub-src") ||
                img.getAttribute("data-epub-svg")
            ) {
                img.setAttribute("loading", "lazy");
                img.setAttribute("decoding", "async");
            }
            continue;
        }

        if (isSafeRasterDataUrl(src)) {
            img.setAttribute("loading", "lazy");
            img.setAttribute("decoding", "async");
            continue;
        }

        if (/^(?:https?:|blob:)/i.test(src)) {
            img.removeAttribute("src");
            continue;
        }

        const resource = resolveResource(src);
        if (!resource || !isSupportedImageMediaType(resource.mediaType)) {
            img.removeAttribute("src");
            continue;
        }

        applyImageMarker(img, resource);
    }

    // Convert inline SVGs into blob-backed <img> markers (sanitized payload).
    for (const svg of Array.from(doc.querySelectorAll("svg"))) {
        const sanitized = sanitizeEpubSvg(svg.outerHTML, doc);
        if (!sanitized) {
            svg.remove();
            continue;
        }

        const replacement = doc.createElement("img");
        replacement.setAttribute(
            "alt",
            svg.querySelector("title")?.textContent?.trim() || ""
        );
        replacement.setAttribute("data-epub-svg", sanitized);
        replacement.setAttribute("data-epub-mime", "image/svg+xml");
        replacement.setAttribute("loading", "lazy");
        replacement.setAttribute("decoding", "async");

        const width = svg.getAttribute("width");
        const height = svg.getAttribute("height");
        if (width) replacement.setAttribute("width", width);
        if (height) replacement.setAttribute("height", height);

        svg.replaceWith(replacement);
    }
};

export const EPUB_IMAGE_MARKER_ATTRIBUTE = {
    src: "data-epub-src",
    mime: "data-epub-mime",
    svg: "data-epub-svg",
} as const;
