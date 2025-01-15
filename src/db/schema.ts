import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const Books = pgTable("books", {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    userId: uuid("user_id").references(() => Users.id).notNull(),
    fileKey: text("file_key").notNull(),
	collectionName: text("collection_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type InsertUser = typeof Users.$inferInsert;
export type SelectUser = typeof Users.$inferSelect;
export type InsertBook = typeof Books.$inferInsert;
export type SelectBook = typeof Books.$inferSelect;