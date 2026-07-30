export const IOS_PDF_UNAVAILABLE_MESSAGE =
    "PDF reading isn’t available on iOS.";

export const bookUnavailableReason = (
    platform: string,
    fileType: "epub" | "pdf" | null
): string | null =>
    platform === "ios" && fileType === "pdf"
        ? IOS_PDF_UNAVAILABLE_MESSAGE
        : null;

export const documentTypesForPlatform = (platform: string): string[] =>
    platform === "ios"
        ? ["application/epub+zip"]
        : ["application/epub+zip", "application/pdf"];

export const isPdfDocument = (
    name: string,
    mimeType?: string | null
): boolean =>
    mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
