export const ensureTrailingSlash = (uri: string) =>
    uri.endsWith("/") ? uri : `${uri}/`;

export const relativeUriWithinDirectory = (
    directoryUri: string,
    fileUri: string
): string | null => {
    const root = ensureTrailingSlash(directoryUri);
    if (!fileUri.startsWith(root)) return null;
    return fileUri.slice(root.length);
};

export const chapterRenderDirectory = ({
    offlineRootUri,
    cacheRootUri,
}: {
    offlineRootUri: string | null;
    cacheRootUri: string;
}) => {
    if (offlineRootUri) {
        const directoryUri = ensureTrailingSlash(offlineRootUri);
        return {
            directoryUri,
            htmlFileUri: `${directoryUri}chapter-view.html`,
            resourceSrc(resourceId: string) {
                return `resources/${encodeURIComponent(resourceId)}`;
            },
            readAccessUri: directoryUri,
        };
    }
    const directoryUri = ensureTrailingSlash(cacheRootUri);
    return {
        directoryUri,
        htmlFileUri: `${directoryUri}chapter-view.html`,
        resourceSrc(resourceId: string) {
            return encodeURIComponent(resourceId);
        },
        readAccessUri: directoryUri,
    };
};

export const rewriteChapterResourceSrcs = (
    html: string,
    resourceSrcById: ReadonlyMap<string, string>
) => {
    let next = html;
    for (const [id, src] of resourceSrcById) {
        next = next.replace(
            new RegExp(`data-reader-resource-id="${id}"`, "g"),
            `src="${src}" data-reader-resource-id="${id}"`
        );
    }
    return next;
};
