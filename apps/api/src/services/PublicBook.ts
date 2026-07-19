import { Books, type SelectBook } from "../db/schema";

export const publicBookSelection = {
    id: Books.id,
    title: Books.title,
    fileType: Books.fileType,
    processingStatus: Books.processingStatus,
    processingError: Books.processingError,
    createdAt: Books.createdAt,
};

export type PublicBook = Pick<
    SelectBook,
    | "id"
    | "title"
    | "fileType"
    | "processingStatus"
    | "processingError"
    | "createdAt"
>;

export const toPublicBook = (book: SelectBook): PublicBook => ({
    id: book.id,
    title: book.title,
    fileType: book.fileType,
    processingStatus: book.processingStatus,
    processingError: book.processingError,
    createdAt: book.createdAt,
});
