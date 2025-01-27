import pdf from 'pdf-parse'
import crypto from 'crypto'

export class PDFUtils{
    async extractTextFromPDF(fileBuffer: Buffer): Promise<string> {
        try {
            const data = await pdf(fileBuffer)
            return data.text
        } catch (error) {
            console.error("Error extracting text from PDF:", error)
            throw error
        }
    }

    chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
        const chunks: string[] = [];
        let start = 0;
        
        while (start < text.length) {
          const end = Math.min(start + chunkSize, text.length);
          const chunk = text.slice(start, end);
          chunks.push(chunk);
          start = end - overlap;
        }
        
        return chunks;
    }

    async pdfMetadata(fileBuffer: Buffer): Promise<any> {
        try {
            const data = await pdf(fileBuffer)
            const metadata = data.metadata
            const hash = crypto.createHash("sha256")
            hash.update(JSON.stringify(metadata))
            return hash.digest("hex")
        } catch (error) {
            console.error("Error extracting metadata from PDF:", error)
            throw error
            
        }
    }
}
