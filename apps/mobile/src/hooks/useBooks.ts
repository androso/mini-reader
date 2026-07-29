import type { PublicBook } from "@reader/contracts";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "@/lib/api";

export const booksQueryKey = ["books"] as const;

export const useBooks = () =>
    useQuery({
        queryKey: booksQueryKey,
        queryFn: async () =>
            (await apiJson<{ books: PublicBook[] }>("/api/books")).books,
        refetchInterval: (query) =>
            query.state.data?.some((book) =>
                ["processing", "queue_failed"].includes(book.processingStatus)
            )
                ? 3000
                : false,
    });
