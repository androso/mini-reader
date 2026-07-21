import type { Config } from "tailwindcss";

export default {
    darkMode: ["class"],
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                // Shadcn CSS variable tokens (kept for component compatibility)
                foreground: "var(--color-ink)",
                card: {
                    DEFAULT: "var(--color-paper-raised)",
                    foreground: "var(--color-ink)",
                },
                popover: {
                    DEFAULT: "var(--color-paper-raised)",
                    foreground: "var(--color-ink)",
                },
                muted: {
                    DEFAULT: "var(--color-paper-2)",
                    foreground: "var(--color-ink-2)",
                },
                accent: {
                    DEFAULT: "var(--color-accent-2-soft)",
                    foreground: "var(--color-ink)",
                },
                destructive: {
                    DEFAULT: "var(--color-accent-3)",
                    foreground: "var(--color-accent-ink)",
                },
                border: "var(--color-rule)",
                input: "var(--color-rule-strong)",
                ring: "var(--color-focus)",
                chart: {
                    "1": "oklch(var(--chart-1))",
                    "2": "oklch(var(--chart-2))",
                    "3": "oklch(var(--chart-3))",
                    "4": "oklch(var(--chart-4))",
                    "5": "oklch(var(--chart-5))",
                },

                // Mentarie design tokens
                background: "var(--color-paper)",
                surface: "var(--color-paper)",
                "surface-bright": "var(--color-paper-raised)",
                "surface-dim": "var(--color-paper-3)",
                "surface-variant": "var(--color-paper-2)",
                "surface-container-lowest": "var(--color-paper-raised)",
                "surface-container-low": "var(--color-paper-2)",
                "surface-container": "var(--color-paper-2)",
                "surface-container-high": "var(--color-paper-3)",
                "surface-container-highest": "var(--color-rule)",
                "surface-tint": "var(--color-ink-2)",
                "inverse-surface": "var(--color-chat)",
                "inverse-on-surface": "var(--color-chat-text)",

                primary: {
                    DEFAULT: "var(--color-accent)",
                    foreground: "var(--color-accent-ink)",
                },
                "primary-container": "var(--color-chat)",
                "primary-fixed": "var(--color-paper-2)",
                "primary-fixed-dim": "var(--color-rule)",
                "inverse-primary": "var(--color-accent)",
                "on-primary": "var(--color-accent-ink)",
                "on-primary-container": "var(--color-chat-muted)",
                "on-primary-fixed": "var(--color-ink)",
                "on-primary-fixed-variant": "var(--color-ink-2)",

                secondary: {
                    DEFAULT: "var(--color-accent-2)",
                    foreground: "var(--color-ink)",
                },
                "secondary-container": "var(--color-accent-2-soft)",
                "secondary-fixed": "var(--color-paper-2)",
                "secondary-fixed-dim": "var(--color-rule)",
                "on-secondary": "var(--color-ink)",
                "on-secondary-container": "var(--color-ink-2)",
                "on-secondary-fixed": "var(--color-ink)",
                "on-secondary-fixed-variant": "var(--color-ink-2)",

                tertiary: "var(--color-focus)",
                "tertiary-container": "var(--color-chat-raised)",
                "tertiary-fixed": "var(--color-accent-2-soft)",
                "tertiary-fixed-dim": "var(--color-rule)",
                "on-tertiary": "var(--color-chat-text)",
                "on-tertiary-container": "var(--color-chat-muted)",
                "on-tertiary-fixed": "var(--color-ink)",
                "on-tertiary-fixed-variant": "var(--color-ink-2)",

                error: "var(--color-accent-3)",
                "error-container": "var(--color-accent-3-soft)",
                "on-error": "var(--color-accent-ink)",
                "on-error-container": "var(--color-ink)",

                outline: "var(--color-ink-2)",
                "outline-variant": "var(--color-rule-strong)",

                "on-background": "var(--color-ink)",
                "on-surface": "var(--color-ink)",
                "on-surface-variant": "var(--color-ink-2)",
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
                xl: "0.75rem",
                full: "9999px",
            },
            fontFamily: {
                sans: ["var(--font-body)"],
                serif: ["var(--font-reading)"],
                label: ["var(--font-label)"],
            },
            transitionDuration: {
                micro: "var(--dur-micro)",
                short: "var(--dur-short)",
                long: "var(--dur-long)",
            },
            transitionTimingFunction: {
                "hallmark-out": "var(--ease-out)",
                "hallmark-in-out": "var(--ease-in-out)",
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
} satisfies Config;
