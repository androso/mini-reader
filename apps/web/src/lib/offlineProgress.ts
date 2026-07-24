import { apiUrl } from "./api";
import {
    getOfflineBook,
    getOfflineProgress,
    listOfflineProgress,
    markProgressSynced,
    putOfflineProgress,
    removeOfflineProgress,
    type OfflineProgressRecord,
} from "./offlineStore";

export type ReadingProgress = {
    progressPosition: string | null;
    progressChapter: string | null;
};

async function postProgress(record: OfflineProgressRecord): Promise<Response> {
    return fetch(apiUrl(`/api/${record.bookId}/progress`), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
            progress_block: record.progressPosition,
            progress_chapter: record.progressChapter,
        }),
    });
}

async function acknowledgeProgress(
    record: OfflineProgressRecord
): Promise<void> {
    await markProgressSynced(record.bookId, record.revision);
    const current = await getOfflineProgress(record.bookId);
    if (
        current?.revision === record.revision &&
        !current.dirty &&
        !(await getOfflineBook(record.bookId))
    ) {
        await removeOfflineProgress(record.bookId);
    }
}

export async function loadReadingProgress(
    bookId: string
): Promise<ReadingProgress> {
    const local = await getOfflineProgress(bookId);
    if (local?.dirty) {
        return {
            progressPosition: local.progressPosition,
            progressChapter: local.progressChapter,
        };
    }

    try {
        const response = await fetch(apiUrl(`/api/${bookId}/progress`), {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
        });
        if (response.ok) {
            const data = (await response.json()) as {
                progressPosition?: string | null;
                progressChapter?: string | null;
            };
            if (data.progressPosition || data.progressChapter) {
                const stored = await putOfflineProgress({
                    bookId,
                    progressPosition: data.progressPosition ?? "",
                    progressChapter: data.progressChapter ?? "",
                    dirty: false,
                });
                return {
                    progressPosition: stored.progressPosition || null,
                    progressChapter: stored.progressChapter || null,
                };
            }
        }
    } catch {
        // The local record below remains authoritative while the API is unavailable.
    }

    return {
        progressPosition: local?.progressPosition || null,
        progressChapter: local?.progressChapter || null,
    };
}

export async function saveReadingProgress(
    bookId: string,
    progressPosition: string,
    progressChapter: string
): Promise<void> {
    const record = await putOfflineProgress({
        bookId,
        progressPosition,
        progressChapter,
        dirty: true,
    });

    try {
        const response = await postProgress(record);
        if (response.ok) {
            await acknowledgeProgress(record);
        } else if (response.status === 404) {
            await removeOfflineProgress(bookId);
        }
    } catch {
        // IndexedDB already contains the latest revision for a later retry.
    }
}

export async function flushPendingProgress(): Promise<void> {
    const pending = (await listOfflineProgress())
        .filter((record) => record.dirty)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

    for (const record of pending) {
        let response: Response;
        try {
            response = await postProgress(record);
        } catch {
            return;
        }

        if (response.ok) {
            await acknowledgeProgress(record);
            continue;
        }
        if (response.status === 404) {
            await removeOfflineProgress(record.bookId);
            continue;
        }
        return;
    }
}
