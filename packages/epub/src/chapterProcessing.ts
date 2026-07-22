import createDOMPurify from "dompurify";
import type { TextBlock } from "./types";

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
    "height",
    "href",
    "id",
    "lang",
    "name",
    "rel",
    "role",
    "rowspan",
    "src",
    "title",
    "width",
].sort();

const SAFE_URL_PATTERN =
    /^(?:(?:https?|mailto|tel|blob):|data:image\/(?:png|gif|jpe?g|webp);|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
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
            SAFE_IMAGE_DATA_URL_PATTERN.test(normalized)
        );
    }

    const protocol = normalized.match(/^[a-z][a-z0-9+.\-]*:/i)?.[0];
    return !protocol || SAFE_ABSOLUTE_PROTOCOLS.has(protocol.toLowerCase());
};

export const sanitizeEpubHtml = (html: string, doc: Document): string => {
    const purify = createDOMPurify(getPurifierWindow(doc));
    const template = doc.createElement("template");
    template.innerHTML = html;
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

    return template.innerHTML;
};

const hasRenderableContent = (element: Element): boolean => {
    const hasText = Boolean(element.textContent?.replace(/\s+/g, " ").trim());
    const hasMedia = Boolean(
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

const collectReadableBlocks = (element: Element): Element[] => {
    if (element.matches(SKIPPED_SELECTOR) || !hasRenderableContent(element)) {
        return [];
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
