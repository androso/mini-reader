"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "./api";

export const PLATFORM_CHAT_MODELS = [
    { value: "gpt-4o-mini", label: "GPT-4o mini" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { value: "gpt-5.5-2026-04-23", label: "GPT-5.5" },
    { value: "gpt-5.4-2026-03-05", label: "GPT-5.4" },
    { value: "gpt-5.4-mini-2026-03-17", label: "GPT-5.4 mini" },
    { value: "gpt-5.4-nano-2026-03-17", label: "GPT-5.4 nano" },
] as const;
export const CODEX_CHAT_MODELS = [
    { value: "gpt-5.6", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
] as const;

export type ChatProviderStatus = {
    codexAvailable: boolean;
    provider: "openai" | "codex";
    connected: boolean;
    reauthRequired: boolean;
    account: { email: string | null; planType: string | null } | null;
    models: string[];
    defaultModel: string;
};

const readJson = async <T>(response: Response): Promise<T> => {
    const body = (await response.json().catch(() => ({}))) as {
        error?: unknown;
    };
    if (!response.ok) {
        throw new Error(
            typeof body.error === "string" ? body.error : "Request failed"
        );
    }
    return body as T;
};

export const fetchChatProviderStatus = async () =>
    readJson<ChatProviderStatus>(
        await fetch(apiUrl("/api/chat-provider"), { credentials: "include" })
    );

export const startCodexAuthorization = async () =>
    readJson<{ authorizationUrl: string; expiresAt: string }>(
        await fetch(apiUrl("/api/chat-provider/codex/authorize"), {
            method: "POST",
            credentials: "include",
        })
    );

export const completeCodexAuthorization = async (redirectUrl: string) =>
    readJson<ChatProviderStatus>(
        await fetch(apiUrl("/api/chat-provider/codex/complete"), {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ redirectUrl }),
        })
    );

export const disconnectCodex = async () => {
    const response = await fetch(apiUrl("/api/chat-provider/codex"), {
        method: "DELETE",
        credentials: "include",
    });
    if (!response.ok) {
        await readJson(response);
    }
};

export const chatModelOptions = (status: ChatProviderStatus) =>
    status.connected && status.provider === "codex"
        ? CODEX_CHAT_MODELS
        : PLATFORM_CHAT_MODELS;

export function useChatProviderStatus() {
    return useQuery({
        queryKey: [apiUrl("/api/chat-provider")],
        queryFn: fetchChatProviderStatus,
        retry: false,
    });
}
