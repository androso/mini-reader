"use client";

import { flushPendingProgress } from "@/lib/offlineProgress";
import { useEffect } from "react";

export function ProgressSynchronizer() {
    useEffect(() => {
        const flush = () => {
            void flushPendingProgress();
        };
        flush();
        window.addEventListener("online", flush);
        return () => window.removeEventListener("online", flush);
    }, []);

    return null;
}
