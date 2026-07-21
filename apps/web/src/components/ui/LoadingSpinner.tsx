"use client";
import { motion } from "motion/react";

export function LoadingSpinner() {
    return (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[color-mix(in_oklch,var(--color-paper)_88%,transparent)]">
            <motion.div
                className="h-12 w-12 rounded-full border-4 border-[var(--color-accent-2)] border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            />
        </div>
    );
}
