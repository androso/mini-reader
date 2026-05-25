import crypto from "crypto";
import PDFParser from "pdf2json";
import { LLMChunker } from "./LlmChunks";

export class PDFUtils {
    private parser: PDFParser;
    private chunker: LLMChunker;
    constructor() {
        this.parser = new PDFParser();
        this.chunker = new LLMChunker();
    }

    async extractTextFromPDF(fileBuffer: Buffer): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const allChunks: string[] = [];

            this.parser.removeAllListeners();

            try {
                this.parser.on("pdfParser_dataReady", async (pdfData) => {
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
                        this.parser.removeAllListeners();
                        resolve(allChunks);
                    } catch (error) {
                        reject(error);
                    }
                });

                this.parser.on("pdfParser_dataError", (error) => {
                    reject(error);
                });

                this.parser.parseBuffer(fileBuffer);
            } catch (error) {
                reject(error);
            }
        });
    }

    async pdfMetadata(fileBuffer: Buffer): Promise<string> {
        return new Promise((resolve, reject) => {
            this.parser.on("pdfParser_dataReady", (pdfData) => {
                try {
                    const metadata = {
                        pages: pdfData.Pages.length,
                        info: pdfData.Meta,
                    };
                    const hash = crypto.createHash("sha256");
                    hash.update(JSON.stringify(metadata));
                    resolve(`pdf_${hash.digest("hex").slice(0, 12)}`);
                } catch (error) {
                    reject(error);
                }
            });

            this.parser.parseBuffer(fileBuffer);
        });
    }
}
