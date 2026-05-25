import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface FileUploadProps {
    onUpload: (file: File) => void;
    isLoading: boolean;
}

export function FileUpload({ onUpload, isLoading }: FileUploadProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const validExtensions = [".epub", ".pdf"];
        const hasValidExtension = validExtensions.some((ext) =>
            file.name.toLowerCase().endsWith(ext)
        );

        if (!hasValidExtension) {
            toast({
                title: "Invalid file",
                description: "Please upload an EPUB or PDF file",
                variant: "destructive",
            });
            return;
        }

        onUpload(file);
    };

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept=".epub,.pdf"
                onChange={handleFileChange}
                className="hidden"
            />
            <Button
                onClick={() => inputRef.current?.click()}
                variant="outline"
                disabled={isLoading}
            >
                <Upload className="h-4 w-4 mr-2" />
                {isLoading ? "Uploading..." : "Upload File"}
            </Button>
        </>
    );
}
