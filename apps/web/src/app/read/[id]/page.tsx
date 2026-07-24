"use client";

import ReaderWorkspace from "@/components/reader/ReaderWorkspace";
import { useParams, useSearchParams } from "next/navigation";

export default function ReaderPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const bookId = params.id as string;
    const fileType = searchParams.get("type");

    return (
        <ReaderWorkspace
            bookId={bookId}
            fileType={fileType}
            requireLocalBook={false}
        />
    );
}
