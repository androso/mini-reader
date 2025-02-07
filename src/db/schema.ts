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
} from "drizzle-orm/pg-core";

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);
export const resourceTypeEnum = pgEnum("resource_type", ["book", "article"]);
export const fileTypeEnum = pgEnum("file_type", ["epub", "pdf"]);

export const Users = pgTable("users", {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").unique().notNull(),
    name: text("name").notNull(),
    image: text("image"),
    googleId: text("google_id").unique(),
    password: text("password"), // For future email+password auth
    username: text("username").unique(), // For future username support
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// here, we call books the .epub and .pdf files
export const Books = pgTable("books", {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    userId: uuid("user_id")
        .references(() => Users.id)
        .notNull(),
    fileKey: text("file_key").notNull(),
    fileType: fileTypeEnum("file_type"),
    collectionName: text("collection_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const Messages = pgTable("messages", {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
        .references(() => Conversations.id, { onDelete: "cascade" })
        .notNull(),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const Progress = pgTable(
    "progress",
    {
        userId: uuid("user_id").notNull(),
        bookId: text("book_id").notNull(),
        progressPosition: text("progress_position").notNull(),
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
        {
            pk: primaryKey({ columns: [table.userId, table.bookId] }),
            bookRef: foreignKey({
                columns: [table.bookId],
                foreignColumns: [Books.id],
                name: "progress_book_id_books_id_fk",
            }).onDelete("cascade"),
            userRef: foreignKey({
                columns: [table.userId],
                foreignColumns: [Users.id],
                name: "progress_user_id_users_id_fk",
            }),
        },
    ]
);

export type InsertUser = typeof Users.$inferInsert;
export type SelectUser = typeof Users.$inferSelect;
export type InsertBook = typeof Books.$inferInsert;
export type SelectBook = typeof Books.$inferSelect;
