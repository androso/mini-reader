export interface EpubMetadata {
    title: string | null;
    creator: string | null;
    identifier?: string | null;
}

export interface ManifestItem {
    href: string;
    mediaType: string;
    properties: string | null;
}

export interface TocEntry {
    title: string;
    level: number;
    id?: string;
    href?: string;
    playOrder?: number;
}

export interface EpubContent {
    metadata: EpubMetadata;
    spine: string[];
    manifest: Record<string, ManifestItem>;
    basePath: string;
    toc: TocEntry[];
    coverReference?: {
        href: string;
        kind: "image" | "document";
    } | null;
}

export interface TextBlock {
    id: string;
    content: string;
    text: string;
}

export interface ChapterBlock {
    id: string;
    hrefId: string;
    textBlocks: TextBlock[];
}

export interface ParsedEpubHref {
    path: string;
    fragment: string | null;
}

export interface ReaderPackageBlock {
    id: string;
    html: string;
    text: string;
}

export interface ReaderPackageChapter {
    id: string;
    title: string | null;
    href: string;
    order: number;
    blocks: ReaderPackageBlock[];
}

export interface ReaderPackageResource {
    id: string;
    mediaType: string;
    bytes: Uint8Array;
    isCover: boolean;
}

export interface ReaderPackage {
    metadata: EpubMetadata;
    chapters: ReaderPackageChapter[];
    toc: Array<{
        title: string;
        level: number;
        chapterId: string | null;
        blockId: string | null;
    }>;
    resources: ReaderPackageResource[];
    coverResourceId: string | null;
}
