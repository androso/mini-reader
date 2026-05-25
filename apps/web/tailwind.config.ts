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
                foreground: "hsl(var(--foreground))",
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                chart: {
                    "1": "hsl(var(--chart-1))",
                    "2": "hsl(var(--chart-2))",
                    "3": "hsl(var(--chart-3))",
                    "4": "hsl(var(--chart-4))",
                    "5": "hsl(var(--chart-5))",
                },

                // Mentarie design tokens
                background: "#f9f9f9",
                surface: "#f9f9f9",
                "surface-bright": "#f9f9f9",
                "surface-dim": "#dadada",
                "surface-variant": "#e2e2e2",
                "surface-container-lowest": "#ffffff",
                "surface-container-low": "#f3f3f3",
                "surface-container": "#eeeeee",
                "surface-container-high": "#e8e8e8",
                "surface-container-highest": "#e2e2e2",
                "surface-tint": "#5d5d6b",
                "inverse-surface": "#2f3131",
                "inverse-on-surface": "#f1f1f1",

                primary: {
                    DEFAULT: "#1f202b",
                    foreground: "#ffffff",
                },
                "primary-container": "#343541",
                "primary-fixed": "#e2e1f1",
                "primary-fixed-dim": "#c6c5d4",
                "inverse-primary": "#c6c5d4",
                "on-primary": "#ffffff",
                "on-primary-container": "#9e9dac",
                "on-primary-fixed": "#1a1b26",
                "on-primary-fixed-variant": "#454652",

                secondary: {
                    DEFAULT: "#5d5f5f",
                    foreground: "#ffffff",
                },
                "secondary-container": "#dfe0e0",
                "secondary-fixed": "#e2e2e2",
                "secondary-fixed-dim": "#c6c6c7",
                "on-secondary": "#ffffff",
                "on-secondary-container": "#616363",
                "on-secondary-fixed": "#1a1c1c",
                "on-secondary-fixed-variant": "#454747",

                tertiary: "#1e2124",
                "tertiary-container": "#333639",
                "tertiary-fixed": "#e0e2e6",
                "tertiary-fixed-dim": "#c4c7ca",
                "on-tertiary": "#ffffff",
                "on-tertiary-container": "#9c9fa2",
                "on-tertiary-fixed": "#191c1f",
                "on-tertiary-fixed-variant": "#44474a",

                error: "#ba1a1a",
                "error-container": "#ffdad6",
                "on-error": "#ffffff",
                "on-error-container": "#93000a",

                outline: "#77767c",
                "outline-variant": "#c8c5cc",

                "on-background": "#1a1c1c",
                "on-surface": "#1a1c1c",
                "on-surface-variant": "#47464c",
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
                xl: "0.75rem",
                full: "9999px",
            },
            fontFamily: {
                sans: ["Plus Jakarta Sans", "Arial", "Helvetica", "sans-serif"],
                serif: ["Literata", "Georgia", "serif"],
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
} satisfies Config;
