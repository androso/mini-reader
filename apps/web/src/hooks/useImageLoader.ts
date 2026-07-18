import { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { ImageObjectUrlRegistry } from "./imageObjectUrlRegistry";

interface ImageResource {
    originalPath: string;
    blobUrl: string;
}

export const useImageLoader = (zipData: JSZip | null, basePath: string) => {
    const [imageResources, setImageResources] = useState<
        Record<string, ImageResource>
    >({});
    const imageResourcesRef = useRef<Record<string, ImageResource>>({});
    const pendingLoadsRef = useRef(new Map<string, Promise<string>>());
    const registryRef = useRef<ImageObjectUrlRegistry | null>(null);
    const archiveRef = useRef<{
        zipData: JSZip | null;
        basePath: string;
        generation: number;
    } | null>(null);

    if (!registryRef.current) {
        registryRef.current = new ImageObjectUrlRegistry((url) =>
            URL.revokeObjectURL(url)
        );
    }

    useEffect(() => {
        const registry = registryRef.current!;
        const pendingLoads = pendingLoadsRef.current;
        const generation = registry.startArchive();
        archiveRef.current = { zipData, basePath, generation };
        pendingLoads.clear();
        imageResourcesRef.current = {};
        setImageResources({});

        return () => {
            registry.dispose(generation);
            if (archiveRef.current?.generation === generation) {
                archiveRef.current = null;
                pendingLoads.clear();
                imageResourcesRef.current = {};
            }
        };
    }, [zipData, basePath]);

    const loadImage = useCallback(
        async (originalPath: string): Promise<string> => {
            const archive = archiveRef.current;
            if (!archive?.zipData) return "";

            const cached = imageResourcesRef.current[originalPath];
            if (cached) return cached.blobUrl;

            const pending = pendingLoadsRef.current.get(originalPath);
            if (pending) return pending;

            const {
                zipData: activeZip,
                basePath: activeBasePath,
                generation,
            } = archive;
            const registry = registryRef.current!;
            const load = (async () => {
                const imageFile =
                    activeZip.file(originalPath) ||
                    activeZip.file(`${activeBasePath}${originalPath}`);

                if (!imageFile) {
                    throw new Error(`Image file not found: ${originalPath}`);
                }
                const arrayBuffer = await imageFile.async("arraybuffer");
                const extension = originalPath.split(".").pop()?.toLowerCase();
                const mimeType =
                    extension === "jpg" || extension === "jpeg"
                        ? "image/jpeg"
                        : extension === "png"
                          ? "image/png"
                          : "image/gif";

                const blob = new Blob([arrayBuffer], { type: mimeType });
                const url = URL.createObjectURL(blob);
                if (!registry.register(generation, url)) return "";

                const resource = { originalPath, blobUrl: url };
                imageResourcesRef.current = {
                    ...imageResourcesRef.current,
                    [originalPath]: resource,
                };
                setImageResources(imageResourcesRef.current);
                return url;
            })();

            pendingLoadsRef.current.set(originalPath, load);
            try {
                return await load;
            } finally {
                if (pendingLoadsRef.current.get(originalPath) === load) {
                    pendingLoadsRef.current.delete(originalPath);
                }
            }
        },
        []
    );

    return { loadImage, imageResources };
};
