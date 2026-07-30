import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
    acceptBookUpload,
    BookUploadEnqueueError,
    BookUploadValidationError,
} from "../src/services/BookUploadAcceptanceService";
import { validateBookUpload } from "../src/utils/validateBookUpload";

const makeZip = async (
    entries: Array<[string, string | Buffer]>,
    compression: "STORE" | "DEFLATE" = "STORE"
) => {
    const zip = new JSZip();
    for (const [name, contents] of entries) zip.file(name, contents);
    return zip.generateAsync({
        type: "nodebuffer",
        compression,
        compressionOptions: { level: 9 },
    });
};

const makeEpub = (...extraEntries: Array<[string, string | Buffer]>) =>
    makeZip([["META-INF/container.xml", "<container />"], ...extraEntries]);

const centralEntryOffsets = (buffer: Buffer) => {
    const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.notEqual(endOffset, -1);
    const count = buffer.readUInt16LE(endOffset + 10);
    let offset = buffer.readUInt32LE(endOffset + 16);
    const offsets: number[] = [];
    for (let index = 0; index < count; index += 1) {
        offsets.push(offset);
        offset +=
            46 +
            buffer.readUInt16LE(offset + 28) +
            buffer.readUInt16LE(offset + 30) +
            buffer.readUInt16LE(offset + 32);
    }
    return offsets;
};

const patchCentralSizes = (
    buffer: Buffer,
    expandedBytes: number,
    compressedBytes: number
) => {
    const patched = Buffer.from(buffer);
    for (const offset of centralEntryOffsets(patched)) {
        patched.writeUInt32LE(compressedBytes, offset + 20);
        patched.writeUInt32LE(expandedBytes, offset + 24);
    }
    return patched;
};

const findCentralEntry = (buffer: Buffer, name: string) => {
    const offset = centralEntryOffsets(buffer).find((entryOffset) =>
        buffer
            .subarray(
                entryOffset + 46,
                entryOffset + 46 + buffer.readUInt16LE(entryOffset + 28)
            )
            .equals(Buffer.from(name))
    );
    assert.notEqual(offset, undefined);
    return offset!;
};

const crc32 = (bytes: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
};

const withLocalName = (
    buffer: Buffer,
    centralName: string,
    localName: string
) => {
    const patched = Buffer.from(buffer);
    const centralOffset = findCentralEntry(patched, centralName);
    const localOffset = patched.readUInt32LE(centralOffset + 42);
    const localNameLength = patched.readUInt16LE(localOffset + 26);
    assert.equal(Buffer.byteLength(localName), localNameLength);
    patched.write(localName, localOffset + 30, localNameLength, "utf8");
    return patched;
};

const unicodePathField = (originalName: string, unicodeName: string) => {
    const encodedName = Buffer.from(unicodeName);
    const field = Buffer.alloc(9 + encodedName.length);
    field.writeUInt16LE(0x7075, 0);
    field.writeUInt16LE(5 + encodedName.length, 2);
    field[4] = 1;
    field.writeUInt32LE(crc32(Buffer.from(originalName)), 5);
    encodedName.copy(field, 9);
    return field;
};

const withUnicodePathOverride = (
    buffer: Buffer,
    entryName: string,
    unicodeName: string
) => {
    const extra = unicodePathField(entryName, unicodeName);
    const originalEndOffset = buffer.lastIndexOf(
        Buffer.from([0x50, 0x4b, 0x05, 0x06])
    );
    const originalCentralOffset = buffer.readUInt32LE(originalEndOffset + 16);
    const originalCentralSize = buffer.readUInt32LE(originalEndOffset + 12);
    const originalEntryOffset = findCentralEntry(buffer, entryName);
    const localOffset = buffer.readUInt32LE(originalEntryOffset + 42);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localInsertOffset =
        localOffset + 30 + localNameLength + localExtraLength;
    let patched = Buffer.concat([
        buffer.subarray(0, localInsertOffset),
        extra,
        buffer.subarray(localInsertOffset),
    ]);
    patched.writeUInt16LE(localExtraLength + extra.length, localOffset + 28);

    const shiftedEntryOffset = originalEntryOffset + extra.length;
    const centralNameLength = patched.readUInt16LE(shiftedEntryOffset + 28);
    const centralExtraLength = patched.readUInt16LE(shiftedEntryOffset + 30);
    const centralInsertOffset =
        shiftedEntryOffset + 46 + centralNameLength + centralExtraLength;
    patched = Buffer.concat([
        patched.subarray(0, centralInsertOffset),
        extra,
        patched.subarray(centralInsertOffset),
    ]);
    patched.writeUInt16LE(
        centralExtraLength + extra.length,
        shiftedEntryOffset + 30
    );
    const endOffset = originalEndOffset + extra.length * 2;
    patched.writeUInt32LE(originalCentralSize + extra.length, endOffset + 12);
    patched.writeUInt32LE(originalCentralOffset + extra.length, endOffset + 16);
    return patched;
};

const expectGenericRejectionWithoutSideEffects = async (buffer: Buffer) => {
    const calls: string[] = [];
    await assert.rejects(
        acceptBookUpload(
            { userId: "user-a", originalFilename: "spoofed.epub", buffer },
            {
                uploadFile: async () => void calls.push("storage"),
                insertBook: async () => {
                    calls.push("database");
                    return {};
                },
                enqueue: async () => void calls.push("queue"),
            }
        ),
        (error) => {
            assert.ok(error instanceof BookUploadValidationError);
            assert.equal(error.message, "Invalid PDF or EPUB file");
            assert.doesNotMatch(error.message, /ZIP|archive|CRC|path|header/i);
            return true;
        }
    );
    assert.deepEqual(calls, []);
};

test("detects PDF content despite a misleading submitted name and MIME", async () => {
    const calls: string[] = [];
    const result = await acceptBookUpload(
        {
            userId: "user-a",
            originalFilename: "renamed.epub",
            buffer: Buffer.from("%PDF-1.7\n"),
        },
        {
            uploadFile: async () => void calls.push("storage"),
            insertBook: async (book) => {
                calls.push("database");
                return book;
            },
            enqueue: async () => void calls.push("queue"),
        }
    );

    assert.equal(result.fileType, "pdf");
    assert.equal(result.uploadPlan.book.fileType, "pdf");
    assert.equal(result.uploadPlan.job.fileType, "pdf");
    assert.equal(result.book.fileType, "pdf");
    assert.equal(result.book.originalFilename, "renamed.epub");
    assert.equal(result.book.title, "renamed.epub");
    assert.deepEqual(calls, ["storage", "database", "queue"]);
});

test("accepts an EPUB container despite a misleading submitted name and MIME", async () => {
    const epub = await makeEpub();
    const result = await acceptBookUpload(
        { userId: "user-a", originalFilename: "book.pdf", buffer: epub },
        {
            uploadFile: async () => {},
            insertBook: async (book) => book,
            enqueue: async () => {},
        }
    );
    assert.equal(result.fileType, "epub");
    assert.equal(result.uploadPlan.book.fileType, "epub");
    assert.equal(result.uploadPlan.job.fileType, "epub");
});

test("rejects arbitrary ZIP files", async () => {
    await assert.rejects(
        validateBookUpload(await makeZip([["file.txt", "not an epub"]])),
        /not an EPUB/
    );
});

test("rejects a spoofed MIME payload", async () => {
    await assert.rejects(
        validateBookUpload(Buffer.from("this is not a PDF")),
        /not PDF or EPUB/
    );
});

for (const unsafePath of ["../book.xhtml", "/book.xhtml", "C:\\book.xhtml"]) {
    test(`rejects unsafe archive path ${unsafePath}`, async () => {
        await assert.rejects(
            validateBookUpload(await makeEpub([unsafePath, "content"])),
            /unsafe archive path/
        );
    });
}

test("rejects more than 5,000 archive entries", async () => {
    const entries: Array<[string, string]> = [
        ["META-INF/container.xml", "<container />"],
    ];
    for (let index = 0; index < 5_000; index += 1) {
        entries.push([`text/${index}.xhtml`, ""]);
    }
    await assert.rejects(
        validateBookUpload(await makeZip(entries)),
        /too many entries/
    );
});

test("rejects an entry over 50 MiB before expansion", async () => {
    const epub = await makeEpub(["text/book.xhtml", "small"]);
    await assert.rejects(
        validateBookUpload(
            patchCentralSizes(epub, 50 * 1024 * 1024 + 1, 1024 * 1024)
        ),
        /entry is too large/
    );
});

test("rejects more than 500 MiB expanded total before expansion", async () => {
    const entries: Array<[string, string]> = [];
    for (let index = 0; index < 10; index += 1) {
        entries.push([`text/${index}.xhtml`, "small"]);
    }
    const epub = await makeEpub(...entries);
    await assert.rejects(
        validateBookUpload(
            patchCentralSizes(epub, 49 * 1024 * 1024, 1024 * 1024)
        ),
        /expanded size is too large/
    );
});

test("rejects expansion ratios over 100:1", async () => {
    const epub = await makeZip(
        [
            ["META-INF/container.xml", "<container />"],
            ["text/book.xhtml", Buffer.alloc(1024 * 1024)],
        ],
        "DEFLATE"
    );
    await assert.rejects(validateBookUpload(epub), /expansion ratio/);
});

test("rejects CRC failures", async () => {
    const epub = await makeEpub(["text/book.xhtml", "content"]);
    const corrupted = Buffer.from(epub);
    const entryOffset = centralEntryOffsets(corrupted).find((offset) =>
        corrupted
            .subarray(
                offset + 46,
                offset + 46 + corrupted.readUInt16LE(offset + 28)
            )
            .toString("utf8")
            .endsWith("book.xhtml")
    );
    assert.notEqual(entryOffset, undefined);
    const localOffset = corrupted.readUInt32LE(entryOffset! + 42);
    const nameLength = corrupted.readUInt16LE(localOffset + 26);
    const extraLength = corrupted.readUInt16LE(localOffset + 28);
    corrupted[localOffset + 30 + nameLength + extraLength] ^= 0xff;
    await assert.rejects(validateBookUpload(corrupted), /CRC32 mismatch/);
});

test("rejects a traversal name hidden in the local file header", async () => {
    const epub = await makeEpub(["aa/book.xhtml", "content"]);
    await expectGenericRejectionWithoutSideEffects(
        withLocalName(epub, "aa/book.xhtml", "../book.xhtml")
    );
});

test("rejects a traversal name in an Info-ZIP Unicode path override", async () => {
    const epub = await makeEpub(["aa/book.xhtml", "content"]);
    await expectGenericRejectionWithoutSideEffects(
        withUnicodePathOverride(epub, "aa/book.xhtml", "../book.xhtml")
    );
});

test("invalid content causes no storage, database, or queue side effects", async () => {
    await expectGenericRejectionWithoutSideEffects(Buffer.from("not a book"));
});

test("enqueue failure surfaces BookUploadEnqueueError after storage and insert", async () => {
    const calls: string[] = [];
    const cause = new Error("queue unavailable");
    await assert.rejects(
        acceptBookUpload(
            {
                userId: "user-a",
                originalFilename: "book.pdf",
                buffer: Buffer.from("%PDF-1.7\n"),
            },
            {
                uploadFile: async () => void calls.push("storage"),
                insertBook: async (book) => {
                    calls.push("database");
                    return book;
                },
                enqueue: async () => {
                    calls.push("queue");
                    throw cause;
                },
            }
        ),
        (error: unknown) => {
            assert.ok(error instanceof BookUploadEnqueueError);
            assert.equal(error.name, "BookUploadEnqueueError");
            assert.equal(error.message, "Book processing queue is unavailable");
            assert.equal(error.cause, cause);
            return true;
        }
    );
    assert.deepEqual(calls, ["storage", "database", "queue"]);
});
