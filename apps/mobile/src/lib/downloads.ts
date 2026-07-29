import * as FileSystem from "expo-file-system/legacy";
import type {
    EpubReaderChapter,
    EpubReaderManifest,
    PublicBook,
} from "@reader/contracts";
import { apiFetch, apiJson, apiUrl, authorizedHeaders } from "./api";
import { deleteDownloadRecord, getDownload, putDownload } from "./database";

const privateRoot = `${FileSystem.documentDirectory}private/`;

const ensureDirectory = async (uri: string) => {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
        await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
    }
};

const safeName = (value: string) => encodeURIComponent(value);

export const bookRoot = (bookId: string) =>
    `${privateRoot}books/${safeName(bookId)}/`;

export const downloadBook = async (
    book: PublicBook,
    onProgress?: (completed: number, total: number) => void
) => {
    if (!book.fileType) throw new Error("Book type is unavailable");
    const root = bookRoot(book.id);
    await ensureDirectory(root);
    await putDownload({
        book_id: book.id,
        file_type: book.fileType,
        status: "downloading",
        root_uri: root,
        completed_items: 0,
        total_items: 1,
    });

    try {
        if (book.fileType === "pdf") {
            await FileSystem.downloadAsync(
                apiUrl(`/api/books/${book.id}`),
                `${root}book.pdf`,
                { headers: authorizedHeaders() }
            );
            onProgress?.(1, 1);
            await putDownload({
                book_id: book.id,
                file_type: "pdf",
                status: "complete",
                root_uri: root,
                completed_items: 1,
                total_items: 1,
            });
            return;
        }

        const manifest = await apiJson<EpubReaderManifest>(
            `/api/books/${book.id}/reader-manifest`
        );
        const total = manifest.chapters.length + manifest.resources.length + 1;
        let completed = 0;
        await FileSystem.writeAsStringAsync(
            `${root}manifest.json`,
            JSON.stringify(manifest)
        );
        completed += 1;
        onProgress?.(completed, total);

        await ensureDirectory(`${root}chapters/`);
        for (const chapter of manifest.chapters) {
            const payload = await apiJson<EpubReaderChapter>(
                `/api/books/${book.id}/reader-chapters/${encodeURIComponent(
                    chapter.id
                )}`
            );
            await FileSystem.writeAsStringAsync(
                `${root}chapters/${safeName(chapter.id)}.json`,
                JSON.stringify(payload)
            );
            completed += 1;
            onProgress?.(completed, total);
            await putDownload({
                book_id: book.id,
                file_type: "epub",
                status: "downloading",
                root_uri: root,
                completed_items: completed,
                total_items: total,
            });
        }

        await ensureDirectory(`${root}resources/`);
        for (const resource of manifest.resources) {
            await FileSystem.downloadAsync(
                apiUrl(`/api/books/${book.id}/reader-resources/${resource.id}`),
                `${root}resources/${safeName(resource.id)}`,
                { headers: authorizedHeaders() }
            );
            completed += 1;
            onProgress?.(completed, total);
            await putDownload({
                book_id: book.id,
                file_type: "epub",
                status: "downloading",
                root_uri: root,
                completed_items: completed,
                total_items: total,
            });
        }
        await putDownload({
            book_id: book.id,
            file_type: "epub",
            status: "complete",
            root_uri: root,
            completed_items: total,
            total_items: total,
        });
    } catch (error) {
        const existing = await getDownload(book.id);
        await putDownload({
            book_id: book.id,
            file_type: book.fileType,
            status: "failed",
            root_uri: root,
            completed_items: existing?.completed_items ?? 0,
            total_items: existing?.total_items ?? 1,
        });
        throw error;
    }
};

export const removeDownload = async (bookId: string) => {
    const root = bookRoot(bookId);
    const info = await FileSystem.getInfoAsync(root);
    if (info.exists) {
        await FileSystem.deleteAsync(root, { idempotent: true });
    }
    await deleteDownloadRecord(bookId);
};

export const clearPrivateFiles = async () => {
    const info = await FileSystem.getInfoAsync(privateRoot);
    if (info.exists) {
        await FileSystem.deleteAsync(privateRoot, { idempotent: true });
    }
};

export const readOfflineManifest = async (bookId: string) => {
    const record = await getDownload(bookId);
    if (record?.status !== "complete" || record.file_type !== "epub")
        return null;
    return JSON.parse(
        await FileSystem.readAsStringAsync(`${record.root_uri}manifest.json`)
    ) as EpubReaderManifest;
};

export const readOfflineChapter = async (bookId: string, chapterId: string) => {
    const record = await getDownload(bookId);
    if (record?.status !== "complete" || record.file_type !== "epub")
        return null;
    return JSON.parse(
        await FileSystem.readAsStringAsync(
            `${record.root_uri}chapters/${safeName(chapterId)}.json`
        )
    ) as EpubReaderChapter;
};

export const resourceUri = async (bookId: string, resourceId: string) => {
    const record = await getDownload(bookId);
    if (record?.status === "complete" && record.file_type === "epub") {
        return `${record.root_uri}resources/${safeName(resourceId)}`;
    }
    const root = `${FileSystem.cacheDirectory}reader-resources/${safeName(
        bookId
    )}/`;
    await ensureDirectory(root);
    const destination = `${root}${safeName(resourceId)}`;
    const existing = await FileSystem.getInfoAsync(destination);
    if (!existing.exists) {
        const response = await apiFetch(
            `/api/books/${bookId}/reader-resources/${resourceId}`
        );
        if (!response.ok) {
            throw new Error("Reader resource could not be loaded");
        }
        await FileSystem.downloadAsync(
            apiUrl(`/api/books/${bookId}/reader-resources/${resourceId}`),
            destination,
            { headers: authorizedHeaders() }
        );
    }
    return destination;
};

export const offlinePdfUri = async (bookId: string) => {
    const record = await getDownload(bookId);
    return record?.status === "complete" && record.file_type === "pdf"
        ? `${record.root_uri}book.pdf`
        : null;
};
