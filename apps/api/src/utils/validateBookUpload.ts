import JSZip from "jszip";

const MAX_EPUB_ENTRIES = 5_000;
const MAX_EPUB_EXPANDED_BYTES = 500 * 1024 * 1024;
const MAX_EPUB_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 100;

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const MIN_END_RECORD_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

const findEndRecord = (buffer: Buffer) => {
    const firstPossibleOffset = Math.max(
        0,
        buffer.length - MIN_END_RECORD_BYTES - MAX_ZIP_COMMENT_BYTES
    );
    for (
        let offset = buffer.length - MIN_END_RECORD_BYTES;
        offset >= firstPossibleOffset;
        offset -= 1
    ) {
        if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
            return offset;
        }
    }
    throw new Error("ZIP end record is missing");
};

const validateArchiveBounds = (buffer: Buffer) => {
    const endOffset = findEndRecord(buffer);
    const diskNumber = buffer.readUInt16LE(endOffset + 4);
    const centralDirectoryDisk = buffer.readUInt16LE(endOffset + 6);
    const entriesOnDisk = buffer.readUInt16LE(endOffset + 8);
    const entryCount = buffer.readUInt16LE(endOffset + 10);
    const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);

    if (
        diskNumber !== 0 ||
        centralDirectoryDisk !== 0 ||
        entriesOnDisk !== entryCount ||
        entryCount === 0xffff ||
        centralDirectorySize === 0xffffffff ||
        centralDirectoryOffset === 0xffffffff
    ) {
        throw new Error("Unsupported ZIP layout");
    }
    if (entryCount > MAX_EPUB_ENTRIES) {
        throw new Error("EPUB contains too many entries");
    }
    const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
    if (
        centralDirectoryEnd > endOffset ||
        centralDirectoryOffset > buffer.length
    ) {
        throw new Error("Invalid ZIP central directory");
    }

    let offset = centralDirectoryOffset;
    let expandedBytes = 0;
    for (let index = 0; index < entryCount; index += 1) {
        if (
            offset + 46 > centralDirectoryEnd ||
            buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY
        ) {
            throw new Error("Invalid ZIP entry metadata");
        }
        const compressedBytes = buffer.readUInt32LE(offset + 20);
        const expandedEntryBytes = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
        if (entryEnd > centralDirectoryEnd) {
            throw new Error("Invalid ZIP entry metadata");
        }

        const name = buffer
            .subarray(offset + 46, offset + 46 + nameLength)
            .toString("utf8");
        const pathParts = name.split(/[\\/]/);
        if (
            name.startsWith("/") ||
            name.startsWith("\\") ||
            /^[A-Za-z]:[\\/]/.test(name) ||
            pathParts.includes("..")
        ) {
            throw new Error("EPUB contains an unsafe archive path");
        }
        if (expandedEntryBytes > MAX_EPUB_ENTRY_BYTES) {
            throw new Error("EPUB entry is too large");
        }
        if (
            expandedEntryBytes > 0 &&
            (compressedBytes === 0 ||
                expandedEntryBytes / compressedBytes > MAX_EXPANSION_RATIO)
        ) {
            throw new Error("EPUB expansion ratio is too large");
        }
        expandedBytes += expandedEntryBytes;
        if (expandedBytes > MAX_EPUB_EXPANDED_BYTES) {
            throw new Error("EPUB expanded size is too large");
        }
        offset = entryEnd;
    }
    if (offset !== centralDirectoryEnd) {
        throw new Error("Invalid ZIP central directory");
    }
};

export const validateBookUpload = async (
    buffer: Buffer
): Promise<"pdf" | "epub"> => {
    if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
    if (
        buffer.length < MIN_END_RECORD_BYTES ||
        buffer.readUInt16LE(0) !== 0x4b50
    ) {
        throw new Error("File signature is not PDF or EPUB");
    }

    validateArchiveBounds(buffer);
    const archive = await JSZip.loadAsync(buffer, { checkCRC32: true });
    const container = archive.file("META-INF/container.xml");
    if (!container || container.dir) {
        throw new Error("ZIP archive is not an EPUB");
    }
    return "epub";
};
