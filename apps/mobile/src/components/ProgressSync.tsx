import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { apiFetch } from "@/lib/api";
import { listPendingProgress, markProgressSynced } from "@/lib/database";

export const syncPendingProgress = async () => {
    const pending = await listPendingProgress();
    for (const progress of pending) {
        const response = await apiFetch(`/api/${progress.book_id}/progress`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                progress_block: progress.progress_position,
                progress_chapter: progress.progress_chapter,
            }),
        });
        if (response.ok) {
            await markProgressSynced(progress.book_id, progress.local_revision);
        }
    }
};

export const ProgressSync = () => {
    const sync = useCallback(() => {
        void NetInfo.fetch().then((state) => {
            if (state.isConnected) return syncPendingProgress();
        });
    }, []);
    useEffect(() => {
        sync();
        const network = NetInfo.addEventListener((state) => {
            if (state.isConnected) sync();
        });
        const appState = AppState.addEventListener("change", (state) => {
            if (state === "active") sync();
        });
        return () => {
            network();
            appState.remove();
        };
    }, [sync]);
    return null;
};
