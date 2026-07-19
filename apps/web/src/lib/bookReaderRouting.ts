import type { Book } from "@/types/bookTypes";

export const createReaderPath = (book: Pick<Book, "id" | "fileType">) =>
    `/read/${book.id}?type=${book.fileType ?? ""}`;

export const isPdfFileType = (fileType: string | null) => fileType === "pdf";
