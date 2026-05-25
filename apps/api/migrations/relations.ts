import { relations } from "drizzle-orm/relations";
import { users, books } from "./schema";

export const booksRelations = relations(books, ({ one }) => ({
    user: one(users, {
        fields: [books.userId],
        references: [users.id],
    }),
}));

export const usersRelations = relations(users, ({ many }) => ({
    books: many(books),
}));
