import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "express";
import {
    handleBookFileDelivery,
    type BookFileRecord,
} from "../src/services/BookFileDelivery";

type TestResponse = {
    statusCode: number;
    body?: unknown;
    contentType?: string;
    headers: Record<string, string>;
    sent?: unknown;
    status(code: number): TestResponse;
    json(payload: unknown): TestResponse;
    type(contentType: string): TestResponse;
    send(payload: unknown): TestResponse;
    setHeader(name: string, value: string): TestResponse;
};

const createResponse = (): TestResponse => ({
    statusCode: 200,
    headers: {},
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.body = payload;
        return this;
    },
    type(contentType) {
        this.contentType = contentType;
        return this;
    },
    send(payload) {
        this.sent = payload;
        return this;
    },
    setHeader(name, value) {
        this.headers[name] = value;
        return this;
    },
});

const successCases: Array<{
    name: string;
    fileType: string | null;
    contentType: string;
}> = [
    { name: "EPUB", fileType: "epub", contentType: "application/epub+zip" },
    { name: "PDF", fileType: "pdf", contentType: "application/pdf" },
    {
        name: "unknown type",
        fileType: null,
        contentType: "application/octet-stream",
    },
];

for (const { name, fileType, contentType } of successCases) {
    test(`delivers an owned ${name} by its private storage key`, async () => {
        const storageCalls: string[] = [];
        const res = createResponse();
        const record: BookFileRecord = {
            id: "book-1",
            userId: "user-1",
            fileKey: "private/object-key-with-misleading-prefix",
            fileType,
        };

        await handleBookFileDelivery(
            "book-1",
            "user-1",
            res as unknown as Response,
            {
                async findBookById(bookId) {
                    assert.equal(bookId, "book-1");
                    return record;
                },
                async getFile(fileKey) {
                    storageCalls.push(fileKey);
                    return Buffer.from("book contents");
                },
            }
        );

        assert.deepEqual(storageCalls, [record.fileKey]);
        assert.equal(res.contentType, contentType);
        assert.equal(res.headers["Cache-Control"], "private");
        assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
        assert.deepEqual(res.sent, Buffer.from("book contents"));
    });
}

test("returns 404 for a missing book without reading storage", async () => {
    const storageCalls: string[] = [];
    const res = createResponse();

    await handleBookFileDelivery(
        "missing-book",
        "user-1",
        res as unknown as Response,
        {
            async findBookById() {
                return undefined;
            },
            async getFile(fileKey) {
                storageCalls.push(fileKey);
                return Buffer.alloc(0);
            },
        }
    );

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: "Book was not found" });
    assert.deepEqual(storageCalls, []);
});

test("returns 403 for a non-owner without reading storage", async () => {
    const storageCalls: string[] = [];
    const res = createResponse();

    await handleBookFileDelivery(
        "book-1",
        "user-2",
        res as unknown as Response,
        {
            async findBookById() {
                return {
                    id: "book-1",
                    userId: "user-1",
                    fileKey: "private-key",
                    fileType: "epub",
                };
            },
            async getFile(fileKey) {
                storageCalls.push(fileKey);
                return Buffer.alloc(0);
            },
        }
    );

    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "Not authorized" });
    assert.deepEqual(storageCalls, []);
});
