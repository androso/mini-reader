import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { type Conversation } from "@/components/reader/ChatHistory";
import { apiUrl } from "@/lib/api";

export const conversationsQueryKey = (bookId: string) => [
    "conversations",
    bookId,
];

export type ConversationsResponse = {
    conversations: Conversation[];
};

const useConversations = (bookId: string) => {
    const fetchConversations = useCallback(async () => {
        const token = localStorage.getItem("token");
        const response = await fetch(
            apiUrl(`/api/book/${bookId}/conversations`),
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );
        if (!response.ok) {
            throw new Error("Failed to fetch conversations");
        }
        return response.json() as Promise<ConversationsResponse>;
    }, [bookId]);

    return useQuery({
        queryKey: conversationsQueryKey(bookId),
        queryFn: fetchConversations,
        enabled: !!bookId,
    });
};

export default useConversations;
