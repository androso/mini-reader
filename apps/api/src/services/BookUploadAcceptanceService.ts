import type { ProcessUploadedBookPayload } from "./BookProcessingService";
import { createBookUploadPlan } from "../utils/bookUpload";
import { validateBookUpload } from "../utils/validateBookUpload";

type UploadPlan = ReturnType<typeof createBookUploadPlan>;

export interface BookUploadAcceptanceDependencies<T> {
    uploadFile(fileKey: string, buffer: Buffer): Promise<void>;
    insertBook(book: UploadPlan["book"]): Promise<T>;
    enqueue(job: ProcessUploadedBookPayload): Promise<void>;
}

export class BookUploadValidationError extends Error {
    constructor() {
        super("Invalid PDF or EPUB file");
        this.name = "BookUploadValidationError";
    }
}

export class BookUploadEnqueueError extends Error {
    constructor(public readonly cause: unknown) {
        super("Book processing queue is unavailable");
        this.name = "BookUploadEnqueueError";
    }
}

export const acceptBookUpload = async <T>(
    input: { userId: string; title: string; buffer: Buffer },
    dependencies: BookUploadAcceptanceDependencies<T>
) => {
    let fileType: ProcessUploadedBookPayload["fileType"];
    try {
        fileType = await validateBookUpload(input.buffer);
    } catch {
        throw new BookUploadValidationError();
    }
    const uploadPlan = createBookUploadPlan(
        input.userId,
        input.title,
        fileType
    );
    await dependencies.uploadFile(uploadPlan.book.fileKey, input.buffer);
    const book = await dependencies.insertBook(uploadPlan.book);
    try {
        await dependencies.enqueue(uploadPlan.job);
    } catch (error) {
        throw new BookUploadEnqueueError(error);
    }
    return { book, fileType, uploadPlan };
};
