"use client";

import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void): () => void {
    window.addEventListener("online", onStoreChange);
    window.addEventListener("offline", onStoreChange);
    return () => {
        window.removeEventListener("online", onStoreChange);
        window.removeEventListener("offline", onStoreChange);
    };
}

export function useOnlineStatus(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => navigator.onLine,
        () => true
    );
}
