import {
    pgTable,
    unique,
    uuid,
    text,
    timestamp,
    foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable(
    "users",
    {
        id: uuid().defaultRandom().primaryKey().notNull(),
        email: text().notNull(),
        name: text().notNull(),
        image: text(),
        googleId: text("google_id"),
        password: text(),
        username: text(),
        createdAt: timestamp("created_at", { mode: "string" })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { mode: "string" })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        unique("users_email_unique").on(table.email),
        unique("users_google_id_unique").on(table.googleId),
        unique("users_username_unique").on(table.username),
    ]
);

export const books = pgTable(
    "books",
    {
        id: uuid().defaultRandom().primaryKey().notNull(),
        title: text().notNull(),
        userId: uuid("user_id").notNull(),
        fileKey: text("file_key").notNull(),
        collectionName: text("collection_name"),
        createdAt: timestamp("created_at", { mode: "string" })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        foreignKey({
            columns: [table.userId],
            foreignColumns: [users.id],
            name: "books_user_id_users_id_fk",
        }),
    ]
);
