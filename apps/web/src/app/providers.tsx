"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { Toaster } from "react-hot-toast";
import { ProgressSynchronizer } from "@/components/ProgressSynchronizer";

export default function Providers({ children }: { children: React.ReactNode }) {
    return (
        <GoogleOAuthProvider
            clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!}
        >
            <QueryClientProvider client={queryClient}>
                <ProgressSynchronizer />
                {children}
            </QueryClientProvider>
            <Toaster />
        </GoogleOAuthProvider>
    );
}
