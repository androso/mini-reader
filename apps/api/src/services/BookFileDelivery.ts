import type { Response } from "express";

export interface BookFileRecord {
    id: string;
    userId: string;
    fileKey: string;
    fileType: string | null;
}

export interface BookFileDeliveryDependencies {
    findBookById(bookId: string): Promise<BookFileRecord | undefined>;
    getFile(fileKey: string): Promise<Buffer>;
}

const getBookContentType = (fileType: string | null) => {
    if (fileType === "pdf") return "application/pdf";
    if (fileType === "epub") return "application/epub+zip";
    return "application/octet-stream";
};

export const handleBookFileDelivery = async (
    bookId: string,
    userId: string,
    res: Response,
    dependencies: BookFileDeliveryDependencies
) => {
    const book = await dependencies.findBookById(bookId);
    if (!book) {
        res.status(404).json({ error: "Book was not found" });
        return;
    }

    if (book.userId !== userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
    }

    const fileBuffer = await dependencies.getFile(book.fileKey);
    res.setHeader("Cache-Control", "private");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(getBookContentType(book.fileType));
    res.send(fileBuffer);
};
