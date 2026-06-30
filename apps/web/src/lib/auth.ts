import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { apiUrl } from "./api";

export interface User {
    id: string;
    name: string;
    email?: string;
    provider?: string;
}

export function useUser() {
    return useQuery({
        queryKey: [apiUrl("/api/user")],
        queryFn: async () => {
            const token = localStorage.getItem("token");
            if (!token) return null;
            const response = await fetch(apiUrl("/api/user"), {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
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
        mutationFn: async (token: string) => {
            try {
                const res = await fetch(apiUrl("/api/auth/google"), {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ token }),
                });

                if (!res.ok) {
                    throw new Error("Authentication failed");
                }

                const data = await res.json();
                localStorage.setItem("token", data.token);
                localStorage.setItem("user", JSON.stringify(data.user));
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
                });

                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(
                        `Dev authentication failed: ${res.status} ${res.statusText}${errorText ? ` - ${errorText}` : ""}`
                    );
                }

                const data = await res.json();
                localStorage.setItem("token", data.token);
                localStorage.setItem("user", JSON.stringify(data.user));
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

export function signOut() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    queryClient.clear();
}
