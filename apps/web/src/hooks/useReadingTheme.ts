"use client";

import { useCallback, useEffect, useState } from "react";

export type ReadingTheme = "light" | "dark";

const READING_THEME_STORAGE_KEY = "reader.colorTheme";

const isReadingTheme = (value: string | null): value is ReadingTheme =>
    value === "light" || value === "dark";

export function useReadingTheme() {
    const [theme, setTheme] = useState<ReadingTheme>("dark");

    useEffect(() => {
        const storedTheme = localStorage.getItem(READING_THEME_STORAGE_KEY);
        if (isReadingTheme(storedTheme)) {
            setTheme(storedTheme);
        }
    }, []);

    const toggleTheme = useCallback(() => {
        setTheme((currentTheme) => {
            const nextTheme = currentTheme === "dark" ? "light" : "dark";
            localStorage.setItem(READING_THEME_STORAGE_KEY, nextTheme);
            return nextTheme;
        });
    }, []);

    return { theme, toggleTheme };
}
