import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

export type BookProcessingStatus = {
    bookId: string;
    fileType: "epub" | "pdf" | null;
    ready: boolean;
    status: "processing" | "ready" | "failed";
    error?: string | null;
};

export const useBookProcessingStatus = (bookId: string) => {
    return useQuery({
        queryKey: ["book-processing-status", bookId],
        queryFn: async (): Promise<BookProcessingStatus> => {
            const token = localStorage.getItem("token");
            const response = await fetch(
                apiUrl(`/api/books/${bookId}/status`),
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (!response.ok) {
                throw new Error("Failed to fetch book processing status");
            }

            return response.json();
        },
        enabled: !!bookId,
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            return status === "ready" || status === "failed" ? false : 3000;
        },
    });
};
