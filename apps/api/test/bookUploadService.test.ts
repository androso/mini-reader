import assert from "node:assert/strict";
import test from "node:test";
import { persistUploadedBook } from "../src/services/BookUploadService";

const fileKey =
    "users/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/books/11111111-1111-1111-1111-111111111111/original";

test("insert failure deletes the uploaded object and preserves the route error", async () => {
    const insertError = new Error("database insert failed");
    const deleted: string[] = [];

    await assert.rejects(
        persistUploadedBook(fileKey, {
            insertBook: async () => {
                throw insertError;
            },
            deleteFile: async (key) => {
                deleted.push(key);
            },
        }),
        (error) => error === insertError
    );

    assert.deepEqual(deleted, [fileKey]);
});

test("cleanup failure never masks the original insert failure", async () => {
    const insertError = new Error("database insert failed");
    const cleanupError = new Error("storage delete failed");
    const cleanupErrors: unknown[] = [];

    await assert.rejects(
        persistUploadedBook(fileKey, {
            insertBook: async () => {
                throw insertError;
            },
            deleteFile: async () => {
                throw cleanupError;
            },
            onCleanupError: (error) => cleanupErrors.push(error),
        }),
        (error) => error === insertError
    );

    assert.deepEqual(cleanupErrors, [cleanupError]);
});
