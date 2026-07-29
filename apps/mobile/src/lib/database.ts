import * as SQLite from "expo-sqlite";
import type { DownloadStatus } from "./downloadState";

let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

export const getDatabase = async () => {
    databasePromise ??= SQLite.openDatabaseAsync("mentarie.db");
    const database = await databasePromise;
    await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS downloads (
            book_id TEXT PRIMARY KEY NOT NULL,
            file_type TEXT NOT NULL,
            status TEXT NOT NULL,
            root_uri TEXT NOT NULL,
            completed_items INTEGER NOT NULL DEFAULT 0,
            total_items INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_progress (
            book_id TEXT PRIMARY KEY NOT NULL,
            progress_position TEXT NOT NULL,
            progress_chapter TEXT NOT NULL,
            local_revision INTEGER NOT NULL,
            synced_revision INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );
    `);
    return database;
};

export type DownloadRecord = {
    book_id: string;
    file_type: "epub" | "pdf";
    status: DownloadStatus;
    root_uri: string;
    completed_items: number;
    total_items: number;
    updated_at: string;
};

export const getDownload = async (bookId: string) => {
    const database = await getDatabase();
    return database.getFirstAsync<DownloadRecord>(
        "SELECT * FROM downloads WHERE book_id = ?",
        bookId
    );
};

export const listDownloads = async () => {
    const database = await getDatabase();
    return database.getAllAsync<DownloadRecord>("SELECT * FROM downloads");
};

export const putDownload = async (
    record: Omit<DownloadRecord, "updated_at">
) => {
    const database = await getDatabase();
    await database.runAsync(
        `INSERT INTO downloads
            (book_id, file_type, status, root_uri, completed_items, total_items, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET
            file_type = excluded.file_type,
            status = excluded.status,
            root_uri = excluded.root_uri,
            completed_items = excluded.completed_items,
            total_items = excluded.total_items,
            updated_at = excluded.updated_at`,
        record.book_id,
        record.file_type,
        record.status,
        record.root_uri,
        record.completed_items,
        record.total_items,
        new Date().toISOString()
    );
};

export const deleteDownloadRecord = async (bookId: string) => {
    const database = await getDatabase();
    await database.runAsync("DELETE FROM downloads WHERE book_id = ?", bookId);
};

export type LocalProgress = {
    book_id: string;
    progress_position: string;
    progress_chapter: string;
    local_revision: number;
    synced_revision: number;
    updated_at: string;
};

export const saveLocalProgress = async (
    bookId: string,
    progressPosition: string,
    progressChapter: string
) => {
    const database = await getDatabase();
    await database.runAsync(
        `INSERT INTO local_progress
            (book_id, progress_position, progress_chapter, local_revision, synced_revision, updated_at)
         VALUES (?, ?, ?, 1, 0, ?)
         ON CONFLICT(book_id) DO UPDATE SET
            progress_position = excluded.progress_position,
            progress_chapter = excluded.progress_chapter,
            local_revision = local_progress.local_revision + 1,
            updated_at = excluded.updated_at`,
        bookId,
        progressPosition,
        progressChapter,
        new Date().toISOString()
    );
    return database.getFirstAsync<LocalProgress>(
        "SELECT * FROM local_progress WHERE book_id = ?",
        bookId
    );
};

export const getLocalProgress = async (bookId: string) => {
    const database = await getDatabase();
    return database.getFirstAsync<LocalProgress>(
        "SELECT * FROM local_progress WHERE book_id = ?",
        bookId
    );
};

export const listPendingProgress = async () => {
    const database = await getDatabase();
    return database.getAllAsync<LocalProgress>(
        "SELECT * FROM local_progress WHERE local_revision > synced_revision"
    );
};

export const markProgressSynced = async (bookId: string, revision: number) => {
    const database = await getDatabase();
    await database.runAsync(
        `UPDATE local_progress
         SET synced_revision = MAX(synced_revision, ?)
         WHERE book_id = ? AND local_revision >= ?`,
        revision,
        bookId,
        revision
    );
};

export const clearPrivateDatabase = async () => {
    const database = await getDatabase();
    await database.execAsync(
        "DELETE FROM downloads; DELETE FROM local_progress;"
    );
};
