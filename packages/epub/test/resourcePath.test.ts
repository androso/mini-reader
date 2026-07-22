import assert from "node:assert/strict";
import test from "node:test";
import {
    findExactManifestEntryByHref,
    normalizeEpubPackagePath,
    normalizeImageMediaType,
    resolveChapterRelativePath,
    resolveEpubImageResource,
} from "../src/resourcePath";
import type { EpubContent } from "../src/types";

const content = (overrides: Partial<EpubContent> = {}): EpubContent => ({
    metadata: { title: "Img", creator: "A" },
    basePath: "OEBPS/",
    spine: ["c1"],
    manifest: {
        c1: {
            href: "text/chapter1.xhtml",
            mediaType: "application/xhtml+xml",
            properties: null,
        },
        img1: {
            href: "images/photo.jpg",
            mediaType: "image/jpeg",
            properties: null,
        },
        img2: {
            href: "images/chart.png",
            mediaType: "image/png",
            properties: null,
        },
        clashA: {
            href: "a/dup.png",
            mediaType: "image/png",
            properties: null,
        },
        clashB: {
            href: "b/dup.png",
            mediaType: "image/png",
            properties: null,
        },
        webp: {
            href: "images/pic.webp",
            mediaType: "image/webp",
            properties: null,
        },
        avif: {
            href: "images/pic.avif",
            mediaType: "image/avif",
            properties: null,
        },
        svg: {
            href: "images/icon.svg",
            mediaType: "image/svg+xml",
            properties: null,
        },
    },
    toc: [],
    ...overrides,
});

test("resolveChapterRelativePath resolves chapter-relative and encoded paths", () => {
    assert.equal(
        resolveChapterRelativePath(
            "../images/photo.jpg",
            "text/chapter1.xhtml"
        ),
        "images/photo.jpg"
    );
    assert.equal(
        resolveChapterRelativePath(
            "../images/%70hoto.jpg",
            "text/chapter1.xhtml"
        ),
        "images/photo.jpg"
    );
    assert.equal(
        resolveChapterRelativePath("images/photo.jpg?foo=1#x", "text/c.xhtml"),
        "text/images/photo.jpg"
    );
});

test("normalizeEpubPackagePath rejects traversal escapes and protocols", () => {
    assert.equal(normalizeEpubPackagePath("../../etc/passwd"), null);
    assert.equal(normalizeEpubPackagePath("https://evil.test/a.png"), null);
    assert.equal(normalizeEpubPackagePath("file:///tmp/a.png"), null);
    assert.equal(
        normalizeEpubPackagePath("images/../images/a.png"),
        "images/a.png"
    );
});

test("exact manifest matching wins and basename collisions fail closed", () => {
    const epub = content();
    assert.equal(
        findExactManifestEntryByHref(epub.manifest, "images/photo.jpg")?.id,
        "img1"
    );
    assert.equal(findExactManifestEntryByHref(epub.manifest, "dup.png"), null);
    assert.equal(
        findExactManifestEntryByHref(epub.manifest, "missing.png"),
        null
    );
});

test("resolveEpubImageResource supports allowed MIME types and rejects remote/missing", () => {
    const epub = content();
    const jpeg = resolveEpubImageResource(
        epub,
        "text/chapter1.xhtml",
        "../images/photo.jpg"
    );
    assert.equal(jpeg?.mediaType, "image/jpeg");
    assert.equal(jpeg?.zipPath, "OEBPS/images/photo.jpg");

    assert.equal(
        resolveEpubImageResource(
            epub,
            "text/chapter1.xhtml",
            "../images/pic.webp"
        )?.mediaType,
        "image/webp"
    );
    assert.equal(
        resolveEpubImageResource(
            epub,
            "text/chapter1.xhtml",
            "../images/pic.avif"
        )?.mediaType,
        "image/avif"
    );
    assert.equal(
        resolveEpubImageResource(
            epub,
            "text/chapter1.xhtml",
            "../images/icon.svg"
        )?.mediaType,
        "image/svg+xml"
    );

    assert.equal(
        resolveEpubImageResource(
            epub,
            "text/chapter1.xhtml",
            "https://cdn.example/a.jpg"
        ),
        null
    );
    assert.equal(
        resolveEpubImageResource(
            epub,
            "text/chapter1.xhtml",
            "../images/missing.jpg"
        ),
        null
    );
});

test("normalizeImageMediaType fails closed for unsupported and mislabeled types", () => {
    assert.equal(normalizeImageMediaType("image/jpeg"), "image/jpeg");
    assert.equal(normalizeImageMediaType("image/jpg"), "image/jpeg");
    assert.equal(
        normalizeImageMediaType("application/octet-stream", "a.png"),
        "image/png"
    );
    assert.equal(normalizeImageMediaType("text/plain", "a.txt"), null);
    assert.equal(normalizeImageMediaType("image/tiff"), null);
});
