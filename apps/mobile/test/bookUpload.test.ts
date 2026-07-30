import assert from "node:assert/strict";
import test from "node:test";
import { buildBookUploadFormData } from "../src/lib/bookUpload.js";

test("buildBookUploadFormData materializes a Blob/File part for expo/fetch", async () => {
    const bytes = Uint8Array.from([37, 80, 68, 70]); // %PDF
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
        new Response(bytes, {
            status: 200,
            headers: { "Content-Type": "application/pdf" },
        })) as typeof fetch;

    try {
        const form = await buildBookUploadFormData({
            uri: "file:///tmp/sample.pdf",
            name: "sample.pdf",
            mimeType: "application/pdf",
        } as never);
        const part = form.get("file");
        assert.ok(part, "expected a file FormData part");
        assert.notEqual(
            Object.prototype.toString.call(part),
            "[object Object]",
            "RN { uri, name, type } parts must not be appended raw"
        );
        assert.equal(
            "name" in (part as object)
                ? (part as { name?: string }).name
                : undefined,
            "sample.pdf"
        );
        assert.equal(
            "type" in (part as object)
                ? (part as { type?: string }).type
                : undefined,
            "application/pdf"
        );
        if (part instanceof Blob) {
            assert.equal(part.size, bytes.byteLength);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("buildBookUploadFormData infers EPUB mime type from the filename", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
        new Response(Uint8Array.from([80, 75]), {
            status: 200,
        })) as typeof fetch;

    try {
        const form = await buildBookUploadFormData({
            uri: "file:///tmp/sample.epub",
            name: "sample.epub",
            mimeType: null,
        } as never);
        const part = form.get("file") as { type?: string };
        assert.equal(part.type, "application/epub+zip");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("buildBookUploadFormData does not assign to Blob getters when File is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    const originalFile = globalThis.File;
    globalThis.fetch = (async () =>
        new Response(Uint8Array.from([80, 75]), {
            status: 200,
        })) as typeof fetch;
    Object.defineProperty(globalThis, "File", {
        value: undefined,
        configurable: true,
    });

    try {
        const form = await buildBookUploadFormData({
            uri: "content://books/infinity.epub",
            name: "infinity.epub",
            mimeType: null,
        } as never);
        const part = form.get("file") as Blob & { name?: string };
        assert.equal(part.name, "infinity.epub");
        assert.equal(part.type, "application/epub+zip");
        assert.equal(part.size, 2);
    } finally {
        globalThis.fetch = originalFetch;
        Object.defineProperty(globalThis, "File", {
            value: originalFile,
            configurable: true,
        });
    }
});
