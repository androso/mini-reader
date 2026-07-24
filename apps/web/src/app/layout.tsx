import localFont from "next/font/local";
import "./globals.css";
import AppProviders from "./providers";
import type { Metadata, Viewport } from "next";

const literata = localFont({
    src: "../../public/fonts/literata-variable.ttf",
    variable: "--font-literata",
    display: "swap",
});

export const viewport: Viewport = {
    themeColor: "#0c1721",
};

export const metadata: Metadata = {
    title: "Mentarie — Read with context",
    description:
        "Read books and ask questions with an assistant that understands the full text.",
    applicationName: "Mentarie",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
        capable: true,
    },
    icons: {
        apple: "/icons/apple-touch-icon.png",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`${literata.variable} antialiased`}>
                <AppProviders>{children}</AppProviders>
            </body>
        </html>
    );
}
