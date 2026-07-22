/**
 * Sanitize embedded SVG markup for safe blob-backed <img> rendering.
 * Keeps static shapes/gradients; strips scripts, handlers, animation,
 * foreignObject, external references, and unsafe CSS.
 */

const ALLOWED_SVG_TAGS = new Set(
    [
        "svg",
        "g",
        "path",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "text",
        "tspan",
        "defs",
        "clippath",
        "mask",
        "pattern",
        "lineargradient",
        "radialgradient",
        "stop",
        "use",
        "symbol",
        "title",
        "desc",
        "image",
        "switch",
        "marker",
        "metadata",
    ].map((tag) => tag.toLowerCase())
);

const FORBIDDEN_SVG_TAGS = new Set(
    [
        "script",
        "foreignObject",
        "iframe",
        "object",
        "embed",
        "handler",
        "animate",
        "animateTransform",
        "animateMotion",
        "animateColor",
        "set",
        "audio",
        "video",
        "style",
    ].map((tag) => tag.toLowerCase())
);

const ALLOWED_SVG_ATTR_PREFIXES = ["aria-", "data-"];
const ALLOWED_SVG_ATTRS = new Set([
    "id",
    "class",
    "viewbox",
    "xmlns",
    "xmlns:xlink",
    "version",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-opacity",
    "opacity",
    "transform",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "offset",
    "stop-color",
    "stop-opacity",
    "clip-path",
    "clip-rule",
    "mask",
    "marker-start",
    "marker-mid",
    "marker-end",
    "preserveAspectRatio",
    "overflow",
    "role",
    "focusable",
    "xml:space",
    "href",
    "xlink:href",
]);

const SAFE_SVG_URL = /^(?:#|data:image\/(?:png|gif|jpe?g|webp);)/i;

const isEventHandlerAttr = (name: string) => /^on/i.test(name);

const isSafeSvgUrl = (value: string): boolean => {
    const normalized = value
        .replace(/[\u0000-\u0020\u007f-\u009f]/g, "")
        .trim();
    if (!normalized) return false;
    if (SAFE_SVG_URL.test(normalized)) return true;
    // Fragment-only local paint server references.
    if (normalized.startsWith("#")) return true;
    return false;
};

const sanitizeCssDeclarations = (css: string): string => {
    const safe: string[] = [];
    for (const declaration of css.split(";")) {
        const [rawProp, ...rest] = declaration.split(":");
        if (!rawProp || rest.length === 0) continue;
        const prop = rawProp.trim().toLowerCase();
        const value = rest.join(":").trim();
        if (!prop || !value) continue;
        if (prop.startsWith("-") || prop.includes("expression")) continue;
        if (/url\s*\(/i.test(value) && !/url\s*\(\s*['"]?#/i.test(value)) {
            continue;
        }
        if (/@import|behavior|javascript:/i.test(value)) continue;
        safe.push(`${prop}: ${value}`);
    }
    return safe.join("; ");
};

const sanitizeElement = (element: Element): void => {
    const tag = element.tagName.toLowerCase();
    if (FORBIDDEN_SVG_TAGS.has(tag) || !ALLOWED_SVG_TAGS.has(tag)) {
        element.remove();
        return;
    }

    for (const attr of Array.from(element.attributes)) {
        const name = attr.name;
        const lower = name.toLowerCase();
        const value = attr.value;

        if (isEventHandlerAttr(lower) || lower === "style") {
            element.removeAttribute(name);
            continue;
        }

        const allowed =
            ALLOWED_SVG_ATTRS.has(lower) ||
            ALLOWED_SVG_ATTR_PREFIXES.some((prefix) =>
                lower.startsWith(prefix)
            );

        if (!allowed) {
            element.removeAttribute(name);
            continue;
        }

        if (lower === "href" || lower === "xlink:href") {
            if (!isSafeSvgUrl(value)) {
                element.removeAttribute(name);
            }
            continue;
        }

        if (/^style$/i.test(lower)) {
            const cleaned = sanitizeCssDeclarations(value);
            if (cleaned) element.setAttribute(name, cleaned);
            else element.removeAttribute(name);
        }
    }

    for (const child of Array.from(element.children)) {
        sanitizeElement(child);
    }
};

export const sanitizeEpubSvg = (
    svgMarkup: string,
    doc: Document
): string | null => {
    if (!svgMarkup.trim()) return null;

    // Prefer XML parsing to preserve SVG element names; fall back to HTML.
    let svg: Element | null = null;
    try {
        const parsed = new DOMParser().parseFromString(
            svgMarkup.trim(),
            "image/svg+xml"
        );
        const parsedSvg = parsed.querySelector("svg");
        if (parsedSvg && !parsed.querySelector("parsererror")) {
            svg = doc.importNode(parsedSvg, true) as Element;
        }
    } catch {
        svg = null;
    }

    if (!svg) {
        const container = doc.createElement("div");
        container.innerHTML = svgMarkup.trim();
        svg = container.querySelector("svg");
    }
    if (!svg) return null;

    sanitizeElement(svg);

    // Drop residual scripts/handlers if any parser reintroduced them.
    svg.querySelectorAll("*").forEach((node) => {
        const tag = node.tagName.toLowerCase();
        if (FORBIDDEN_SVG_TAGS.has(tag) || !ALLOWED_SVG_TAGS.has(tag)) {
            node.remove();
            return;
        }
        for (const attr of Array.from(node.attributes)) {
            if (
                isEventHandlerAttr(attr.name) ||
                attr.name.toLowerCase() === "style"
            ) {
                const cleaned =
                    attr.name.toLowerCase() === "style"
                        ? sanitizeCssDeclarations(attr.value)
                        : "";
                if (cleaned) node.setAttribute("style", cleaned);
                else node.removeAttribute(attr.name);
            }
        }
    });

    if (!svg.getAttribute("xmlns")) {
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    const serialized = svg.outerHTML.trim();
    return serialized.length > 0 ? serialized : null;
};
