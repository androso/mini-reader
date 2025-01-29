import { ChromaService } from "./ChromaService";
import { PDFUtils } from "../utils/pdfUtils";

export class PDFService {
    private chromaService: ChromaService;
    private pdfUtils: PDFUtils;

    constructor() {
        this.chromaService = new ChromaService();
        this.pdfUtils = new PDFUtils();
    }
    // should be a pdf file buffer
    async processPDF(file: Buffer) {
        try {
            const chunks = await this.pdfUtils.extractTextFromPDF(file);
            if (!chunks.length) {
                throw new Error("No text found in PDF");
            }
            const collection: string = await this.pdfUtils.pdfMetadata(file);
            if (!collection) {
                throw new Error("No metadata found in PDF");
            }
            console.log("Background processing completed for PDF");
            await this.chromaService.addDocuments(collection, chunks);
            console.log(
                `Background processing completed for PDF ${collection}`
            );
            return { collection, chunks: chunks.length };
        } catch (error) {
            console.error(`Background processing failed for PDF`, error);
            throw error;
        }
    }
}
