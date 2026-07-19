import JSZip from "jszip";

const MAX_EPUB_ENTRIES = 5_000;
const MAX_EPUB_EXPANDED_BYTES = 500 * 1024 * 1024;
const MAX_EPUB_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 100;

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const UNICODE_PATH_EXTRA_FIELD = 0x7075;
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

const validateArchivePath = (name: string) => {
    const pathParts = name.split(/[\\/]/);
    if (
        name.startsWith("/") ||
        name.startsWith("\\") ||
        /^[A-Za-z]:[\\/]/.test(name) ||
        pathParts.includes("..")
    ) {
        throw new Error("EPUB contains an unsafe archive path");
    }
};

const readUnicodePath = (extraFields: Buffer) => {
    let offset = 0;
    let unicodePath: string | undefined;
    while (offset < extraFields.length) {
        if (offset + 4 > extraFields.length) {
            throw new Error("Invalid ZIP extra fields");
        }
        const fieldId = extraFields.readUInt16LE(offset);
        const fieldSize = extraFields.readUInt16LE(offset + 2);
        const fieldEnd = offset + 4 + fieldSize;
        if (fieldEnd > extraFields.length) {
            throw new Error("Invalid ZIP extra fields");
        }
        if (fieldId === UNICODE_PATH_EXTRA_FIELD) {
            if (fieldSize < 5 || extraFields[offset + 4] !== 1) {
                throw new Error("Invalid ZIP Unicode path field");
            }
            const decoded = extraFields
                .subarray(offset + 9, fieldEnd)
                .toString("utf8");
            validateArchivePath(decoded);
            if (unicodePath !== undefined && unicodePath !== decoded) {
                throw new Error("Conflicting ZIP Unicode paths");
            }
            unicodePath = decoded;
        }
        offset = fieldEnd;
    }
    return unicodePath;
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
    const entryNames = new Set<string>();
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

        const centralNameBytes = buffer.subarray(
            offset + 46,
            offset + 46 + nameLength
        );
        const centralName = centralNameBytes.toString("utf8");
        validateArchivePath(centralName);
        const centralUnicodePath = readUnicodePath(
            buffer.subarray(
                offset + 46 + nameLength,
                offset + 46 + nameLength + extraLength
            )
        );

        const localOffset = buffer.readUInt32LE(offset + 42);
        if (
            localOffset + 30 > centralDirectoryOffset ||
            buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER
        ) {
            throw new Error("Invalid ZIP local header");
        }
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const localHeaderEnd =
            localOffset + 30 + localNameLength + localExtraLength;
        if (localHeaderEnd > centralDirectoryOffset) {
            throw new Error("Invalid ZIP local header");
        }
        const localNameBytes = buffer.subarray(
            localOffset + 30,
            localOffset + 30 + localNameLength
        );
        const localName = localNameBytes.toString("utf8");
        validateArchivePath(localName);
        const localUnicodePath = readUnicodePath(
            buffer.subarray(localOffset + 30 + localNameLength, localHeaderEnd)
        );
        const centralIdentity = centralUnicodePath ?? centralName;
        const localIdentity = localUnicodePath ?? localName;
        if (
            !centralNameBytes.equals(localNameBytes) ||
            centralIdentity !== localIdentity
        ) {
            throw new Error("ZIP entry names do not match");
        }
        entryNames.add(centralIdentity);
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
    return entryNames;
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

    const entryNames = validateArchiveBounds(buffer);
    const archive = await JSZip.loadAsync(buffer, { checkCRC32: true });
    for (const entry of Object.values(archive.files)) {
        const exposedName = entry.unsafeOriginalName ?? entry.name;
        validateArchivePath(exposedName);
        if (!entryNames.has(exposedName)) {
            throw new Error("ZIP entry names do not match");
        }
    }
    const container = archive.file("META-INF/container.xml");
    if (!container || container.dir) {
        throw new Error("ZIP archive is not an EPUB");
    }
    return "epub";
};
