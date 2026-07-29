import { JSDOM } from "jsdom";

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
