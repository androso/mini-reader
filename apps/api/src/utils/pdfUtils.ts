import crypto from "crypto";
import PDFParser from "pdf2json";

export class PDFUtils {
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
