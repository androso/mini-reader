import crypto from "crypto";
import PDFParser, { type Output as PdfOutput } from "pdf2json";
import { TextChunker } from "./chunkText";
import {
    normalizeBookMetadataValue,
    type ExtractedBookContent,
    type ExtractedBookMetadata,
} from "./bookProcessing";

export const decodePdfTextRuns = (runs: ReadonlyArray<{ T: string }>) =>
    runs.map((run) => decodeURIComponent(run.T)).join("");

const parsePdf = (fileBuffer: Buffer): Promise<PdfOutput> =>
    new Promise((resolve, reject) => {
        const parser = new PDFParser();
        const cleanup = () => parser.removeAllListeners();

        parser.on("pdfParser_dataReady", (pdfData) => {
            cleanup();
            resolve(pdfData);
        });
        parser.on("pdfParser_dataError", (error) => {
            cleanup();
            reject(error);
        });
        parser.parseBuffer(fileBuffer);
    });

const normalizePdfMetadata = (metadata: unknown): ExtractedBookMetadata => {
    const meta =
        metadata && typeof metadata === "object"
            ? (metadata as Record<string, unknown>)
            : {};
    return {
        title: normalizeBookMetadataValue(meta.Title),
        creator: normalizeBookMetadataValue(meta.Author),
        identifier: null,
    };
};

export const extractPdfBook = async (
    fileBuffer: Buffer,
    chunker = new TextChunker(),
    parse: (buffer: Buffer) => Promise<PdfOutput> = parsePdf
): Promise<ExtractedBookContent> => {
    const pdfData = await parse(fileBuffer);
    const chunks: string[] = [];
    for (const page of pdfData.Pages) {
        const textPage = page.Texts.map((text) =>
            decodePdfTextRuns(text.R)
        ).join(" ");
        chunks.push(...chunker.chunkText(textPage));
    }
    return {
        chunks,
        metadata: normalizePdfMetadata(pdfData.Meta),
    };
};

export const extractPdfMetadata = async (
    fileBuffer: Buffer
): Promise<ExtractedBookMetadata> => {
    const pdfData = await parsePdf(fileBuffer);
    return normalizePdfMetadata(pdfData.Meta);
};

export const createPdfCollectionName = async (
    fileBuffer: Buffer
): Promise<string> =>
    new Promise((resolve, reject) => {
        const parser = new PDFParser();
        const cleanup = () => parser.removeAllListeners();

        parser.on("pdfParser_dataReady", (pdfData) => {
            try {
                const hash = crypto.createHash("sha256");
                hash.update(
                    JSON.stringify({
                        pages: pdfData.Pages.length,
                        info: pdfData.Meta,
                    })
                );
                cleanup();
                resolve(`pdf_${hash.digest("hex").slice(0, 12)}`);
            } catch (error) {
                cleanup();
                reject(error);
            }
        });

        parser.on("pdfParser_dataError", (error) => {
            cleanup();
            reject(error);
        });

        parser.parseBuffer(fileBuffer);
    });
