import { ChromaService } from "./ChromaService";
import { PDFUtils } from "../utils/pdfUtils";
import { OpenAIService } from "./OpenAIServices";

export class PDFService {
    private chromaService: ChromaService;
    private pdfUtils: PDFUtils;
    private openAIService: OpenAIService;

    constructor() {
        this.chromaService = new ChromaService();
        this.pdfUtils = new PDFUtils();
        this.openAIService = new OpenAIService();
    }

    async processInBackground(file: Buffer) {
        try {
            const text = await this.pdfUtils.extractTextFromPDF(file);
            const chunks = this.pdfUtils.chunkText(text);
            const collection = await this.pdfUtils.pdfMetadata(file);

            const embeddings = await Promise.all(
                chunks.map((chunk) => this.chromaService.createEmbedding(chunk))
            );
            await this.chromaService.storeDocumentsChunks(
                collection,
                chunks,
                embeddings
            );
            console.log(`Background processing completed for PDF ${collection}`);
            return { collection, chunks: chunks.length };
        } catch (error) {
            console.error(`Background processing failed for PDF`, error);
            throw error;
        }
    }
    async queryPdf(question: string, collection: string){
        try {
            const embeddingQuestion = await this.chromaService.createEmbedding(question);

            const results = await this.chromaService.searchSimilarChunks(collection, embeddingQuestion);
            const context = results.documents.join("\n\n");
            const answer = await this.openAIService.generateResponse(context, question);
            return answer;
        } catch (error) {
            console.error(`Error querying PDF ${collection}:`, error);
            throw error;
            
        }
    }
}
