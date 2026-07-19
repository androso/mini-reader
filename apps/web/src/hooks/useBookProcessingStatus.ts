import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

export type BookProcessingStatus = {
    bookId: string;
    fileType: "epub" | "pdf" | null;
    ready: boolean;
    status: "processing" | "ready" | "queue_failed" | "failed";
    error?: string | null;
};

export const useBookProcessingStatus = (bookId: string) => {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ["book-processing-status", bookId],
        queryFn: async (): Promise<BookProcessingStatus> => {
            const response = await fetch(
                apiUrl(`/api/books/${bookId}/status`),
                {
                    credentials: "include",
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
            return status === "ready" ||
                status === "queue_failed" ||
                status === "failed"
                ? false
                : 3000;
        },
    });

    const retryMutation = useMutation({
        mutationFn: async () => {
            const response = await fetch(apiUrl(`/api/books/${bookId}/retry`), {
                method: "POST",
                credentials: "include",
            });
            if (!response.ok) {
                throw new Error("Failed to retry document processing");
            }
            return response.json() as Promise<{
                bookId: string;
                status: "processing";
            }>;
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({
                queryKey: ["book-processing-status", bookId],
            });
        },
    });

    return {
        ...query,
        retry: retryMutation.mutateAsync,
        isRetrying: retryMutation.isPending,
        retryError: retryMutation.error,
    };
};
