import { createBookCollectionName } from "@reader/processing";
import { deleteFile, vectorStore } from "@reader/providers";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { BookProcessingJobs, Books } from "../db/schema";
import { bookSearchChunkStore } from "./BookSearchChunkStore";
import { hybridBookSearchService } from "./HybridBookSearchService";

export type DeletableBook = {
    id: string;
    userId: string;
    fileKey: string;
    collectionName: string | null;
    processingStatus: string;
};

export interface BookDeletionRepository {
    findBook(bookId: string): Promise<DeletableBook | null>;
    markDeleting(bookId: string, userId: string): Promise<DeletableBook | null>;
    deleteProcessingJob(bookId: string): Promise<void>;
    countOtherFileReferences(bookId: string, fileKey: string): Promise<number>;
    countOtherCollectionReferences(
        bookId: string,
        collectionName: string
    ): Promise<number>;
    deleteBook(bookId: string, userId: string): Promise<void>;
}

export interface BookDeletionArtifacts {
    deleteFile(fileKey: string): Promise<unknown>;
    deleteVectorCollection(collectionName: string): Promise<unknown>;
    deleteSearchChunks(collectionName: string): Promise<unknown>;
    clearCollectionCache(collectionName: string): void;
}

export interface BookDeletionDependencies {
    repository: BookDeletionRepository;
    artifacts: BookDeletionArtifacts;
}

export class BookDeletionNotFoundError extends Error {
    constructor() {
        super("Book was not found");
        this.name = "BookDeletionNotFoundError";
    }
}

export class BookDeletionForbiddenError extends Error {
    constructor() {
        super("Not authorized");
        this.name = "BookDeletionForbiddenError";
    }
}

const selection = {
    id: Books.id,
    userId: Books.userId,
    fileKey: Books.fileKey,
    collectionName: Books.collectionName,
    processingStatus: Books.processingStatus,
};

export const bookDeletionRepository: BookDeletionRepository = {
    async findBook(bookId) {
        const [book] = await db
            .select(selection)
            .from(Books)
            .where(eq(Books.id, bookId))
            .limit(1);
        return book ?? null;
    },

    async markDeleting(bookId, userId) {
        const [book] = await db
            .update(Books)
            .set({ processingStatus: "deleting" })
            .where(and(eq(Books.id, bookId), eq(Books.userId, userId)))
            .returning(selection);
        return book ?? null;
    },

    async deleteProcessingJob(bookId) {
        await db
            .delete(BookProcessingJobs)
            .where(eq(BookProcessingJobs.bookId, bookId));
    },

    async countOtherFileReferences(bookId, fileKey) {
        const [result] = await db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(Books)
            .where(
                and(
                    ne(Books.id, bookId),
                    eq(Books.fileKey, fileKey),
                    ne(Books.processingStatus, "deleting")
                )
            );
        return result?.count ?? 0;
    },

    async countOtherCollectionReferences(bookId, collectionName) {
        const [result] = await db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(Books)
            .where(
                and(
                    ne(Books.id, bookId),
                    eq(Books.collectionName, collectionName),
                    ne(Books.processingStatus, "deleting")
                )
            );
        return result?.count ?? 0;
    },

    async deleteBook(bookId, userId) {
        await db
            .delete(Books)
            .where(
                and(
                    eq(Books.id, bookId),
                    eq(Books.userId, userId),
                    eq(Books.processingStatus, "deleting")
                )
            );
    },
};

const bookDeletionArtifacts: BookDeletionArtifacts = {
    deleteFile,
    deleteVectorCollection: (collectionName) =>
        vectorStore.deleteCollection(collectionName),
    deleteSearchChunks: (collectionName) =>
        bookSearchChunkStore.deleteCollectionChunks(collectionName),
    clearCollectionCache: (collectionName) =>
        hybridBookSearchService.clearCollectionCache(collectionName),
};

const getArtifactErrorDetail = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    return error as {
        code?: unknown;
        name?: unknown;
        status?: unknown;
        statusCode?: unknown;
        message?: unknown;
        $metadata?: { httpStatusCode?: unknown };
    };
};

const isMissingFileError = (error: unknown) => {
    const detail = getArtifactErrorDetail(error);
    if (!detail) return false;
    return ["ENOENT", "NoSuchKey"].includes(String(detail.code));
};

const isMissingVectorCollectionError = (error: unknown) => {
    const detail = getArtifactErrorDetail(error);
    if (!detail) return false;
    if (
        detail.status === 404 ||
        detail.statusCode === 404 ||
        detail.$metadata?.httpStatusCode === 404
    ) {
        return true;
    }
    if (["NotFound", "ChromaNotFoundError"].includes(String(detail.code))) {
        return true;
    }
    const message =
        `${detail.name ?? ""} ${detail.message ?? ""}`.toLowerCase();
    return (
        message.includes("collection") &&
        (message.includes("not found") || message.includes("does not exist"))
    );
};

const ignoreMissingArtifact = async (
    operation: () => Promise<unknown>,
    isMissing: (error: unknown) => boolean
) => {
    try {
        await operation();
    } catch (error) {
        if (!isMissing(error)) throw error;
    }
};

export const deleteBookCollectionArtifacts = async (
    collectionName: string,
    artifacts: Pick<
        BookDeletionArtifacts,
        "deleteVectorCollection" | "deleteSearchChunks" | "clearCollectionCache"
    > = bookDeletionArtifacts
) => {
    await ignoreMissingArtifact(
        () => artifacts.deleteVectorCollection(collectionName),
        isMissingVectorCollectionError
    );
    await artifacts.deleteSearchChunks(collectionName);
    artifacts.clearCollectionCache(collectionName);
};

export const deleteOwnedBook = async (
    bookId: string,
    userId: string,
    dependencies: BookDeletionDependencies = {
        repository: bookDeletionRepository,
        artifacts: bookDeletionArtifacts,
    }
) => {
    const existing = await dependencies.repository.findBook(bookId);
    if (!existing) throw new BookDeletionNotFoundError();
    if (existing.userId !== userId) throw new BookDeletionForbiddenError();

    const book = await dependencies.repository.markDeleting(bookId, userId);
    if (!book) throw new BookDeletionNotFoundError();

    await dependencies.repository.deleteProcessingJob(book.id);

    const fileReferences =
        await dependencies.repository.countOtherFileReferences(
            book.id,
            book.fileKey
        );
    if (fileReferences === 0) {
        await ignoreMissingArtifact(
            () => dependencies.artifacts.deleteFile(book.fileKey),
            isMissingFileError
        );
    }

    const collectionName =
        book.collectionName ?? createBookCollectionName(book.id);
    const collectionReferences =
        await dependencies.repository.countOtherCollectionReferences(
            book.id,
            collectionName
        );
    if (collectionReferences === 0) {
        await deleteBookCollectionArtifacts(
            collectionName,
            dependencies.artifacts
        );
    }

    await dependencies.repository.deleteBook(book.id, userId);
};
