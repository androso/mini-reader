import type { TextBlock } from "../types/EpubReader";

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

const SKIPPED_SELECTOR = "script,style,link,meta,title";

const hasRenderableContent = (element: Element): boolean => {
    const hasText = Boolean(element.textContent?.replace(/\s+/g, " ").trim());
    const hasMedia = Boolean(
        element.querySelector("img,svg,math,table,figure,canvas")
    );

    return hasText || hasMedia;
};

const hasNestedReadableBlock = (element: Element): boolean =>
    Boolean(element.querySelector(READABLE_BLOCK_SELECTOR));

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
    Array.from(doc.body.children).flatMap((child) => collectReadableBlocks(child));

export const buildTextBlocksFromDocument = (
    doc: Document,
    chapterId: string
): TextBlock[] =>
    getReadableBlockElements(doc).map((element, index) => {
        const blockElement = doc.createElement("div");
        blockElement.innerHTML = element.outerHTML;

        return {
            id: `${chapterId}-block-${index}`,
            content: element.outerHTML,
            element: blockElement,
        };
    });
