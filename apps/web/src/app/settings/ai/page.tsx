"use client";

import { AuthProtection } from "@/components/AuthProtection";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
    completeCodexAuthorization,
    disconnectCodex,
    startCodexAuthorization,
    useChatProviderStatus,
} from "@/lib/chatProvider";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { apiUrl } from "@/lib/api";

function AISettings() {
    const router = useRouter();
    const isOnline = useOnlineStatus();
    const queryClient = useQueryClient();
    const statusQuery = useChatProviderStatus();
    const [redirectUrl, setRedirectUrl] = useState("");
    const [authorizationStarted, setAuthorizationStarted] = useState(false);
    const statusKey = [apiUrl("/api/chat-provider")];

    const authorize = useMutation({
        mutationFn: async () => {
            const popup = window.open("", "_blank");
            if (!popup) throw new Error("Allow popups to connect Codex.");
            try {
                const result = await startCodexAuthorization();
                popup.location.href = result.authorizationUrl;
                return result;
            } catch (error) {
                popup.close();
                throw error;
            }
        },
        onSuccess: () => setAuthorizationStarted(true),
        onError: (error) => toast.error(error.message),
    });

    const complete = useMutation({
        mutationFn: () => completeCodexAuthorization(redirectUrl),
        onSuccess: async (status) => {
            setRedirectUrl("");
            setAuthorizationStarted(false);
            queryClient.setQueryData(statusKey, status);
            await queryClient.invalidateQueries({ queryKey: statusKey });
            toast.success("Codex account connected.");
        },
        onError: (error) => {
            setRedirectUrl("");
            toast.error(error.message);
        },
    });

    const disconnect = useMutation({
        mutationFn: disconnectCodex,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: statusKey });
            toast.success("Codex account disconnected.");
        },
        onError: (error) => toast.error(error.message),
    });

    const status = statusQuery.data;
    const actionsDisabled =
        !isOnline ||
        statusQuery.isPending ||
        authorize.isPending ||
        complete.isPending ||
        disconnect.isPending;

    return (
        <main className="min-h-[100dvh] bg-[var(--color-paper)] px-4 py-8 text-[var(--color-ink)] sm:px-8">
            <div className="mx-auto max-w-2xl">
                <button
                    type="button"
                    onClick={() => router.push("/")}
                    className="secondary-button mb-8"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to library
                </button>
                <section className="rounded-[var(--radius-panel)] border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-6 sm:p-8">
                    <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-focus)]">
                        Experimental
                    </p>
                    <h1 className="mt-2 text-3xl font-bold tracking-tight">
                        AI provider
                    </h1>
                    <p className="mt-4 leading-relaxed text-[var(--color-ink-2)]">
                        Codex covers generated chat responses only. Book
                        ingestion and semantic search still use the server’s
                        OpenAI API key.
                    </p>

                    {statusQuery.isPending ? (
                        <p className="mt-8">Loading provider status…</p>
                    ) : !status?.codexAvailable ? (
                        <p className="mt-8 rounded-[var(--radius-input)] border border-[var(--color-rule)] p-4">
                            Codex connection is disabled by this Reader
                            operator.
                        </p>
                    ) : status.connected ? (
                        <div className="mt-8 space-y-4">
                            <div className="rounded-[var(--radius-input)] border border-[var(--color-rule)] p-4">
                                <p className="font-semibold">Codex connected</p>
                                {status.account?.email && (
                                    <p className="mt-1 text-sm">
                                        {status.account.email}
                                    </p>
                                )}
                                {status.account?.planType && (
                                    <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                                        Plan: {status.account.planType}
                                    </p>
                                )}
                            </div>
                            <button
                                type="button"
                                disabled={actionsDisabled}
                                onClick={() => disconnect.mutate()}
                                className="secondary-button"
                            >
                                Disconnect Codex
                            </button>
                        </div>
                    ) : (
                        <div className="mt-8 space-y-5">
                            {status.reauthRequired && (
                                <p className="rounded-[var(--radius-input)] border border-[var(--color-accent-3)] p-4">
                                    Codex authorization expired. Connect again
                                    to resume subscription-backed chat.
                                </p>
                            )}
                            <button
                                type="button"
                                disabled={actionsDisabled}
                                onClick={() => authorize.mutate()}
                                className="primary-button"
                            >
                                <ExternalLink className="h-4 w-4" />
                                Connect Codex
                            </button>
                            {authorizationStarted && (
                                <form
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        complete.mutate();
                                    }}
                                    className="space-y-3 rounded-[var(--radius-input)] border border-[var(--color-rule)] p-4"
                                >
                                    <label
                                        htmlFor="codex-redirect-url"
                                        className="block font-semibold"
                                    >
                                        Finish sign-in in the opened tab. When
                                        the browser cannot reach the localhost
                                        page, copy the full{" "}
                                        <code>
                                            http://localhost:1455/auth/callback?...
                                        </code>{" "}
                                        address from its address bar and paste
                                        it here.
                                    </label>
                                    <input
                                        id="codex-redirect-url"
                                        required
                                        type="url"
                                        value={redirectUrl}
                                        onChange={(event) =>
                                            setRedirectUrl(event.target.value)
                                        }
                                        disabled={actionsDisabled}
                                        className="h-12 w-full rounded-[var(--radius-input)] border border-[var(--color-rule)] bg-[var(--color-paper)] px-3"
                                    />
                                    <button
                                        type="submit"
                                        disabled={
                                            actionsDisabled ||
                                            !redirectUrl.trim()
                                        }
                                        className="primary-button"
                                    >
                                        Complete connection
                                    </button>
                                </form>
                            )}
                        </div>
                    )}
                    {!isOnline && (
                        <p className="mt-6 text-sm text-[var(--color-ink-2)]">
                            Connection settings are unavailable while offline.
                        </p>
                    )}
                </section>
            </div>
        </main>
    );
}

export default function AISettingsPage() {
    return (
        <AuthProtection>
            <AISettings />
        </AuthProtection>
    );
}
