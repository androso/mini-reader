export type BookFileType = "epub" | "pdf";

export interface ProcessBookJobPayload {
    bookId: string;
    userId: string;
    fileKey: string;
    fileType: BookFileType;
}
