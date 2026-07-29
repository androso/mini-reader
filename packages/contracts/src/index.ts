export type BookFileType = "epub" | "pdf";
export type BookProcessingState =
    | "processing"
    | "ready"
    | "failed"
    | "queue_failed"
    | "deleting";

export interface PublicUser {
    id: string;
    email: string;
    name: string;
    image: string | null;
    username: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PublicBook {
    id: string;
    title: string;
    fileType: BookFileType | null;
    processingStatus: BookProcessingState;
    processingError: string | null;
    createdAt: string;
}

export interface MobileSession {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresIn: number;
    refreshTokenExpiresAt: string;
    user: PublicUser;
}

export interface ProgressRecord {
    bookId: string;
    progressPosition: string | null;
    progressChapter: string | null;
    updatedAt?: string;
}

export interface EpubReaderBlock {
    id: string;
    html: string;
    text: string;
}

export interface EpubReaderChapterSummary {
    id: string;
    title: string | null;
    href: string;
    order: number;
    firstBlockId: string | null;
}

export interface EpubReaderResource {
    id: string;
    mediaType: string;
    size: number;
}

export interface EpubReaderManifest {
    bookId: string;
    title: string;
    creator: string | null;
    status: "ready";
    chapters: EpubReaderChapterSummary[];
    toc: Array<{
        title: string;
        level: number;
        chapterId: string | null;
        blockId: string | null;
    }>;
    resources: EpubReaderResource[];
    coverResourceId: string | null;
    generatedAt: string;
}

export interface EpubReaderChapter {
    bookId: string;
    id: string;
    title: string | null;
    href: string;
    order: number;
    blocks: EpubReaderBlock[];
}

export interface Conversation {
    id: string;
    title: string;
    resourceType: "book";
    resourceId: string;
    createdAt: string;
    lastMessageAt: string;
}

export interface MessageContextSource {
    sourceType: "book" | "web";
    excerpt?: string;
    title?: string;
    url?: string;
}

export interface ChatMessage {
    id: string;
    conversationId?: string;
    role: "user" | "assistant";
    content: string;
    contextSources?: MessageContextSource[] | null;
    completionStatus?: "complete" | "truncated" | "cancelled" | "failed" | null;
    finishReason?: string | null;
    createdAt?: string;
}

export type ChatStreamEvent =
    | { type: "conversation_id"; conversationId: string }
    | { type: "status"; status: "searching_web" }
    | { type: "sources"; sources: MessageContextSource[] }
    | {
          type: "terminal";
          status: "complete" | "truncated" | "cancelled" | "failed";
          finishReason: string | null;
      }
    | { content: string }
    | { error: string };

export interface HighlightContext {
    sourceType: "epub";
    text: string;
    chapterId: string;
    blockId: string;
}
