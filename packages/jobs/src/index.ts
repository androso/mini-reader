export type BookFileType = "epub" | "pdf";

export interface BookProcessingJobData {
    bookId: string;
    userId: string;
    fileKey: string;
    fileType: BookFileType;
}
