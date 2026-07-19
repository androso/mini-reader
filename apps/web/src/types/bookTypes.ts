export interface Book {
    id: string;
    title: string;
    fileType?: "epub" | "pdf" | null;
    processingStatus: string;
    processingError: string | null;
    createdAt: Date | string;
}
