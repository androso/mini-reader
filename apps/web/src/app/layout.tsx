import localFont from "next/font/local";
import "./globals.css";
import AppProviders from "./providers";
import { Metadata } from "next";

const literata = localFont({
    src: "../../public/fonts/literata-variable.ttf",
    variable: "--font-literata",
    display: "swap",
});

export const metadata: Metadata = {
    title: "Mentarie — Read with context",
    description:
        "Read books and ask questions with an assistant that understands the full text.",
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
