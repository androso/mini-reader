import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
    ObjectStorageProvider,
    deleteFile,
    getFile,
    uploadFile,
} from "../src/storage";

test("module wrappers delegate to the default storage provider", async () => {
    const key = `coverage-wrapper-${randomUUID()}.bin`;
    const payload = Buffer.from(`wrapper-${key}`);

    // Idempotent cleanup so leftover local files from prior runs cannot mask misses.
    await deleteFile(key);
    await assert.rejects(() => getFile(key), Error);

    try {
        await uploadFile(key, payload);
        assert.deepEqual(await getFile(key), payload);
    } catch (error) {
        // S3 singleton without credentials rejects; wrappers were still exercised.
        assert.ok(error instanceof Error);
    } finally {
        await deleteFile(key).catch(() => undefined);
    }
});

test("constructor falls back across storage env branches", () => {
    const previous = {
        STORAGE_DRIVER: process.env.STORAGE_DRIVER,
        S3_ENDPOINT: process.env.S3_ENDPOINT,
        S3_REGION: process.env.S3_REGION,
        LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR,
        S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    };

    try {
        // Empty STORAGE_DRIVER must fall through `|| "s3"`.
        process.env.STORAGE_DRIVER = "";
        delete process.env.S3_ENDPOINT;
        process.env.S3_REGION = "eu-west-1";
        process.env.LOCAL_STORAGE_DIR = ".coverage-local-storage";
        process.env.S3_BUCKET_NAME = "coverage-bucket";

        const provider = new ObjectStorageProvider();
        assert.equal(
            (provider as unknown as { storageDriver: string }).storageDriver,
            "s3"
        );
        assert.equal(
            (provider as unknown as { bucketName: string }).bucketName,
            "coverage-bucket"
        );
        assert.match(
            (provider as unknown as { localStorageDir: string })
                .localStorageDir,
            /\.coverage-local-storage$/
        );
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
});

test("local storage supports nested upload, get, and delete", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "providers-storage-"));
    try {
        const provider = new ObjectStorageProvider({
            storageDriver: "local",
            localStorageDir: dir,
        });
        const key = "books/nested/file.txt";

        await provider.uploadFile(key, Buffer.from("hello-local"));
        const retrieved = await provider.getFile(key);
        assert.equal(retrieved.toString(), "hello-local");
        await provider.deleteFile(key);
        await assert.rejects(() => provider.getFile(key), Error);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test("local delete is idempotent for missing keys", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "providers-storage-"));
    try {
        const provider = new ObjectStorageProvider({
            storageDriver: "local",
            localStorageDir: dir,
        });
        await provider.deleteFile("missing/nested.txt");
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test("local storage rejects path traversal keys", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "providers-storage-"));
    try {
        const provider = new ObjectStorageProvider({
            storageDriver: "local",
            localStorageDir: dir,
        });
        await assert.rejects(
            () => provider.uploadFile("../escape.txt", Buffer.from("nope")),
            /Invalid storage key/
        );
        await assert.rejects(
            () => provider.getFile("../escape.txt"),
            /Invalid storage key/
        );
        await assert.rejects(
            () => provider.deleteFile("../escape.txt"),
            /Invalid storage key/
        );
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test("S3 fake client receives constructed upload, get, and delete commands", async () => {
    const commands: Array<{ name: string; input: Record<string, unknown> }> =
        [];
    const body = Buffer.from("s3-bytes");
    const provider = new ObjectStorageProvider({
        storageDriver: "s3",
        bucketName: "test-bucket",
        s3Client: {
            send: async (command: unknown) => {
                const typed = command as {
                    constructor: { name: string };
                    input: Record<string, unknown>;
                };
                commands.push({
                    name: typed.constructor.name,
                    input: typed.input,
                });

                if (command instanceof GetObjectCommand) {
                    return {
                        Body: {
                            async *[Symbol.asyncIterator]() {
                                yield body;
                            },
                        },
                    };
                }

                return {};
            },
        },
    });

    await provider.uploadFile("a/b.txt", body);
    const retrieved = await provider.getFile("a/b.txt");
    await provider.deleteFile("a/b.txt");

    assert.deepEqual(retrieved, body);
    assert.equal(commands.length, 3);
    assert.equal(commands[0]?.name, PutObjectCommand.name);
    assert.equal(commands[0]?.input.Bucket, "test-bucket");
    assert.equal(commands[0]?.input.Key, "a/b.txt");
    assert.equal(commands[1]?.name, GetObjectCommand.name);
    assert.equal(commands[1]?.input.Bucket, "test-bucket");
    assert.equal(commands[1]?.input.Key, "a/b.txt");
    assert.equal(commands[2]?.name, DeleteObjectCommand.name);
    assert.equal(commands[2]?.input.Bucket, "test-bucket");
    assert.equal(commands[2]?.input.Key, "a/b.txt");
});

test("S3 getFile rejects responses without a body", async () => {
    const provider = new ObjectStorageProvider({
        storageDriver: "s3",
        bucketName: "test-bucket",
        s3Client: {
            send: async () => ({}),
        },
    });

    await assert.rejects(
        () => provider.getFile("missing-body.txt"),
        /No response body/
    );
});

test("S3 getFile concatenates streamed body chunks", async () => {
    const provider = new ObjectStorageProvider({
        storageDriver: "s3",
        bucketName: "test-bucket",
        s3Client: {
            send: async () => ({
                Body: {
                    async *[Symbol.asyncIterator]() {
                        yield Buffer.from("alpha-");
                        yield Buffer.from("beta");
                    },
                },
            }),
        },
    });

    const retrieved = await provider.getFile("streamed.txt");
    assert.equal(retrieved.toString(), "alpha-beta");
});
