"use client";

import { Moon, Sun } from "lucide-react";
import type { ReadingTheme } from "@/hooks/useReadingTheme";

interface ReadingThemeToggleProps {
    theme: ReadingTheme;
    onToggle: () => void;
    compact?: boolean;
    className?: string;
}

export function ReadingThemeToggle({
    theme,
    onToggle,
    compact = false,
    className = "",
}: ReadingThemeToggleProps) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const label = `Use ${nextTheme} theme`;

    return (
        <button
            type="button"
            onClick={onToggle}
            className={`reading-theme-toggle ${compact ? "reading-theme-toggle--compact" : ""} ${className}`}
            aria-label={label}
            title={label}
        >
            {nextTheme === "light" ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
            )}
            {!compact && (
                <span>{nextTheme === "light" ? "Light" : "Dark"}</span>
            )}
        </button>
    );
}
