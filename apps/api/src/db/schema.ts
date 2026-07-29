import {
    pgTable,
    text,
    timestamp,
    uuid,
    pgEnum,
    integer,
    primaryKey,
    foreignKey,
    ForeignKey,
    uniqueIndex,
    index,
    jsonb,
    boolean,
    customType,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[] | null; driverData: string | null }>(
    {
        dataType() {
            return "vector(1536)";
        },
        toDriver(value) {
            if (!value) return null;
            return `[${value.join(",")}]`;
        },
    }
);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);
export const messageCompletionStatusEnum = pgEnum("message_completion_status", [
    "complete",
    "truncated",
    "cancelled",
    "failed",
]);
export const resourceTypeEnum = pgEnum("resource_type", ["book", "article"]);
export const fileTypeEnum = pgEnum("file_type", ["epub", "pdf"]);
export const bookProcessingJobStatusEnum = pgEnum(
    "book_processing_job_status",
    ["queued", "processing", "retrying", "completed", "failed"]
);
export const readerPackageJobStatusEnum = pgEnum("reader_package_job_status", [
    "queued",
    "processing",
    "retrying",
    "completed",
    "failed",
]);

export const Users = pgTable("users", {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").unique().notNull(),
    name: text("name").notNull(),
    image: text("image"),
    googleId: text("google_id").unique(),
    passwordHash: text("password"),
    username: text("username").unique(), // For future username support
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const CodexCredentials = pgTable("codex_credentials", {
    userId: uuid("user_id")
        .primaryKey()
        .references(() => Users.id, { onDelete: "cascade" }),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    accountId: text("account_id"),
    email: text("email"),
    planType: text("plan_type"),
    pendingState: text("pending_state"),
    pendingVerifierEncrypted: text("pending_verifier_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    pendingExpiresAt: timestamp("pending_expires_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    reauthRequired: boolean("reauth_required").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const MobileSessions = pgTable(
    "mobile_sessions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .references(() => Users.id, { onDelete: "cascade" })
            .notNull(),
        tokenHash: text("token_hash").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        revokedAt: timestamp("revoked_at", { withTimezone: true }),
        replacedById: uuid("replaced_by_id"),
        lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        index("mobile_sessions_user_id_idx").on(table.userId),
        index("mobile_sessions_expires_at_idx").on(table.expiresAt),
    ]
);

// here, we call books the .epub and .pdf files
export const Books = pgTable("books", {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    originalFilename: text("original_filename").notNull(),
    embeddedTitle: text("embedded_title"),
    creator: text("creator"),
    identifier: text("identifier"),
    metadataExtractedAt: timestamp("metadata_extracted_at"),
    userId: uuid("user_id")
        .references(() => Users.id)
        .notNull(),
    fileKey: text("file_key").notNull(),
    fileType: fileTypeEnum("file_type"),
    collectionName: text("collection_name"),
    processingStatus: text("processing_status").default("processing").notNull(),
    processingError: text("processing_error"),
    readerPackageStatus: text("reader_package_status")
        .default("not_requested")
        .notNull(),
    readerPackageError: text("reader_package_error"),
    readerPackageGeneratedAt: timestamp("reader_package_generated_at", {
        withTimezone: true,
    }),
    readerPackageToc:
        jsonb("reader_package_toc").$type<ReaderPackageTocEntry[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReaderChapterBlock = {
    id: string;
    html: string;
    text: string;
};

export type ReaderPackageTocEntry = {
    title: string;
    level: number;
    chapterId: string | null;
    blockId: string | null;
};

export const ReaderChapters = pgTable(
    "reader_chapters",
    {
        bookId: uuid("book_id")
            .references(() => Books.id, { onDelete: "cascade" })
            .notNull(),
        id: text("id").notNull(),
        title: text("title"),
        href: text("href").notNull(),
        chapterOrder: integer("chapter_order").notNull(),
        blocks: jsonb("blocks").$type<ReaderChapterBlock[]>().notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        primaryKey({
            columns: [table.bookId, table.id],
            name: "reader_chapters_book_id_id_pk",
        }),
        uniqueIndex("reader_chapters_book_order_idx").on(
            table.bookId,
            table.chapterOrder
        ),
    ]
);

export const ReaderResources = pgTable(
    "reader_resources",
    {
        bookId: uuid("book_id")
            .references(() => Books.id, { onDelete: "cascade" })
            .notNull(),
        id: text("id").notNull(),
        storageKey: text("storage_key").notNull(),
        mediaType: text("media_type").notNull(),
        size: integer("size").notNull(),
        isCover: boolean("is_cover").default(false).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        primaryKey({
            columns: [table.bookId, table.id],
            name: "reader_resources_book_id_id_pk",
        }),
        uniqueIndex("reader_resources_storage_key_idx").on(table.storageKey),
    ]
);

export const ReaderPackageJobs = pgTable(
    "reader_package_jobs",
    {
        id: text("id").primaryKey(),
        bookId: uuid("book_id")
            .references(() => Books.id, { onDelete: "cascade" })
            .notNull(),
        userId: uuid("user_id")
            .references(() => Users.id, { onDelete: "cascade" })
            .notNull(),
        status: readerPackageJobStatusEnum("status")
            .default("queued")
            .notNull(),
        attempts: integer("attempts").default(0).notNull(),
        maxAttempts: integer("max_attempts").default(3).notNull(),
        lastError: text("last_error"),
        availableAt: timestamp("available_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        lockedAt: timestamp("locked_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        uniqueIndex("reader_package_jobs_book_id_idx").on(table.bookId),
        index("reader_package_jobs_due_idx").on(
            table.status,
            table.availableAt
        ),
    ]
);

export const BookSearchChunks = pgTable(
    "book_search_chunks",
    {
        id: text("id").primaryKey(),
        collectionName: text("collection_name").notNull(),
        chunkIndex: integer("chunk_index").notNull(),
        content: text("content").notNull(),
        embedding: vector("embedding"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("book_search_chunks_collection_chunk_idx").on(
            table.collectionName,
            table.chunkIndex
        ),
    ]
);

export const BookProcessingJobs = pgTable(
    "book_processing_jobs",
    {
        id: text("id").primaryKey(),
        bookId: uuid("book_id")
            .references(() => Books.id, { onDelete: "cascade" })
            .notNull(),
        userId: uuid("user_id").notNull(),
        fileKey: text("file_key").notNull(),
        fileType: fileTypeEnum("file_type").notNull(),
        status: bookProcessingJobStatusEnum("status")
            .default("queued")
            .notNull(),
        attempts: integer("attempts").default(0).notNull(),
        maxAttempts: integer("max_attempts").default(3).notNull(),
        lastError: text("last_error"),
        availableAt: timestamp("available_at").defaultNow().notNull(),
        lockedAt: timestamp("locked_at"),
        completedAt: timestamp("completed_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("book_processing_jobs_book_id_idx").on(table.bookId),
        index("book_processing_jobs_due_idx").on(
            table.status,
            table.availableAt
        ),
    ]
);

export const Conversations = pgTable("conversations", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
        .references(() => Users.id)
        .notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
    resourceType: resourceTypeEnum("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
});

export type BookMessageContextSource = {
    sourceType: "book";
    id: string;
    chunkIndex: number;
    score: number;
    bestRank: number;
    excerpt: string;
};

export type WebMessageContextSource = {
    sourceType: "web";
    url: string;
    title: string;
};

export type MessageContextSource =
    | BookMessageContextSource
    | WebMessageContextSource;

export type MessageTokenUsage = {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
};

export type MessageExecutionMetadata = {
    modelId: string | null;
    generationDurationMs: number;
    totalLatencyMs: number;
    usage: MessageTokenUsage | null;
    langfuseTraceId: string | null;
};

export const Messages = pgTable("messages", {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
        .references(() => Conversations.id, { onDelete: "cascade" })
        .notNull(),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    contextSources: jsonb("context_sources").$type<
        MessageContextSource[] | null
    >(),
    completionStatus: messageCompletionStatusEnum("completion_status"),
    finishReason: text("finish_reason"),
    executionMetadata: jsonb(
        "execution_metadata"
    ).$type<MessageExecutionMetadata | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const Progress = pgTable(
    "progress",
    {
        userId: uuid("user_id").notNull(),
        bookId: uuid("book_id").notNull(),
        progressPosition: text("progress_position").notNull(),
        progressChapter: text("progress_chapter").notNull(),
        lastReadAt: timestamp("last_read_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        primaryKey({
            columns: [table.userId, table.bookId],
            name: "progress_user_id_book_id_pk",
        }),
        foreignKey({
            columns: [table.bookId],
            foreignColumns: [Books.id],
            name: "progress_book_id_books_id_fk",
        }).onDelete("cascade"),
        foreignKey({
            columns: [table.userId],
            foreignColumns: [Users.id],
            name: "progress_user_id_users_id_fk",
        }).onDelete("cascade"),
    ]
);

export type InsertUser = typeof Users.$inferInsert;
export type SelectUser = typeof Users.$inferSelect;
export type InsertBook = typeof Books.$inferInsert;
export type SelectBook = typeof Books.$inferSelect;
