import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { apiUrl } from "./api";

export interface User {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    username?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface EmailLoginCredentials {
    email: string;
    password: string;
}

export interface EmailSignupCredentials {
    username: string;
    email: string;
    password: string;
}

async function jsonAuthPost<T>(urlPath: string, payload?: unknown): Promise<T> {
    const res = await fetch(apiUrl(urlPath), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message =
            data && typeof data.message === "string"
                ? data.message
                : "Authentication failed";
        throw new Error(message);
    }
    return data as T;
}

export function useUser() {
    return useQuery({
        queryKey: [apiUrl("/api/user")],
        queryFn: async () => {
            const response = await fetch(apiUrl("/api/user"), {
                credentials: "include",
            });
            if (!response.ok) {
                throw new Error("Network response was not ok");
            }
            return response.json();
        },
        enabled: true,
        retry: false,
    });
}

export function useGoogleSignIn() {
    return useMutation({
        mutationFn: async (idToken: string) => {
            try {
                const res = await fetch(apiUrl("/api/auth/google"), {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    credentials: "include",
                    body: JSON.stringify({ idToken }),
                });

                if (!res.ok) {
                    throw new Error("Authentication failed");
                }

                const data = await res.json();
                return data;
            } catch (error) {
                console.error("Error in Google sign-in mutation:", error);
                throw error;
            }
        },
        onSuccess: () => {
            try {
                queryClient.invalidateQueries({
                    queryKey: [apiUrl("/api/user")],
                });
            } catch (error) {
                console.error("Error in onSuccess callback:", error);
            }
        },
    });
}

export function useDevSignIn() {
    return useMutation({
        mutationFn: async () => {
            try {
                const res = await fetch(apiUrl("/api/auth/dev"), {
                    method: "POST",
                    credentials: "include",
                });

                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(
                        `Dev authentication failed: ${res.status} ${res.statusText}${errorText ? ` - ${errorText}` : ""}`
                    );
                }

                const data = await res.json();
                return data;
            } catch (error) {
                console.error("Error in dev sign-in mutation:", error);
                throw error;
            }
        },
        onSuccess: () => {
            try {
                queryClient.invalidateQueries({
                    queryKey: [apiUrl("/api/user")],
                });
            } catch (error) {
                console.error(
                    "Error in dev sign-in onSuccess callback:",
                    error
                );
            }
        },
    });
}

export function useEmailLogin() {
    return useMutation({
        mutationFn: async (credentials: EmailLoginCredentials) => {
            return jsonAuthPost<{ user: User }>("/api/auth/login", credentials);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: [apiUrl("/api/user")],
            });
        },
    });
}

export function useEmailSignup() {
    return useMutation({
        mutationFn: async (credentials: EmailSignupCredentials) => {
            return jsonAuthPost<{ user: User }>(
                "/api/auth/signup",
                credentials
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: [apiUrl("/api/user")],
            });
        },
    });
}

export async function signOut() {
    try {
        await fetch(apiUrl("/api/auth/logout"), {
            method: "POST",
            credentials: "include",
        });
    } finally {
        queryClient.clear();
    }
}
