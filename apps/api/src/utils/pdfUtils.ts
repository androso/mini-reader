import crypto from "crypto";
import PDFParser from "pdf2json";
import { LLMChunker } from "./LlmChunks";

export class PDFUtils {
    private chunker: LLMChunker;
    constructor() {
        this.chunker = new LLMChunker();
    }

    async extractTextFromPDF(fileBuffer: Buffer): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const parser = new PDFParser();
            const allChunks: string[] = [];

            const cleanup = () => parser.removeAllListeners();

            try {
                parser.on("pdfParser_dataReady", async (pdfData) => {
                    try {
                        for (const page of pdfData.Pages) {
                            const textPage = page.Texts.map((text) =>
                                decodeURIComponent(text.R[0].T)
                            ).join(" ");

                            if (textPage.trim()) {
                                try {
                                    const chunks =
                                        await this.chunker.chunkText(textPage);
                                    console.log(
                                        `[extractTextFromPDF] chunked into ${chunks.length} parts`
                                    );
                                    allChunks.push(...chunks);
                                } catch (chunkError) {
                                    console.error(
                                        `[extractTextFromPDF] Error chunking:`,
                                        chunkError
                                    );
                                    if (textPage.length <= 8000) {
                                        allChunks.push(textPage);
                                        console.log(
                                            `[extractTextFromPDF] Added as single chunk`
                                        );
                                    }
                                }
                            }
                        }

                        console.log(
                            `PDF parsing completed. Total chunks: ${allChunks.length}`
                        );
                        cleanup();
                        resolve(allChunks);
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
            } catch (error) {
                cleanup();
                reject(error);
            }
        });
    }

    async pdfMetadata(fileBuffer: Buffer): Promise<string> {
        return new Promise((resolve, reject) => {
            const parser = new PDFParser();
            const cleanup = () => parser.removeAllListeners();

            parser.on("pdfParser_dataReady", (pdfData) => {
                try {
                    const metadata = {
                        pages: pdfData.Pages.length,
                        info: pdfData.Meta,
                    };
                    const hash = crypto.createHash("sha256");
                    hash.update(JSON.stringify(metadata));
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
    }
}
