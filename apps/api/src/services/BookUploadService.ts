export interface UploadedBookPersistenceDependencies<T> {
    insertBook(): Promise<T>;
    deleteFile(fileKey: string): Promise<void>;
    onCleanupError?(error: unknown): void;
}

export const persistUploadedBook = async <T>(
    fileKey: string,
    dependencies: UploadedBookPersistenceDependencies<T>
): Promise<T> => {
    try {
        return await dependencies.insertBook();
    } catch (insertError) {
        try {
            await dependencies.deleteFile(fileKey);
        } catch (cleanupError) {
            dependencies.onCleanupError?.(cleanupError);
        }
        throw insertError;
    }
};
