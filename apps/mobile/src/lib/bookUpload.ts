import type { DocumentPickerAsset } from "expo-document-picker";
import { isPdfDocument } from "./bookCompatibility.js";

const mimeForAsset = (asset: DocumentPickerAsset) =>
    asset.mimeType ??
    (isPdfDocument(asset.name) ? "application/pdf" : "application/epub+zip");

/**
 * expo/fetch multipart conversion rejects React Native `{ uri, name, type }`
 * FormData parts. Materialize a real Blob/File so uploads work on iOS and Android.
 */
export const buildBookUploadFormData = async (
    asset: DocumentPickerAsset
): Promise<FormData> => {
    const mimeType = mimeForAsset(asset);
    const response = await fetch(asset.uri);
    if (!response.ok) {
        throw new Error("The selected book file could not be read.");
    }
    const blob = await response.blob();
    const file =
        typeof File === "function"
            ? new File([blob], asset.name, { type: mimeType })
            : Object.assign(blob, { name: asset.name, type: mimeType });
    const form = new FormData();
    form.append("file", file);
    return form;
};
