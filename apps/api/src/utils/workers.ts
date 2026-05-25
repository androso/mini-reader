import { parentPort, workerData } from "worker_threads";
import { OpenAIService } from "../services/OpenAIServices";

async function analyzeChunkGroup(chunks: string[]) {
    const openAIService = new OpenAIService();
    try {
        const result = await openAIService.analyzeChunks(chunks);
        parentPort?.postMessage({ success: true, splits: result });
    } catch (error) {
        parentPort?.postMessage({ success: false, error: error });
    }
}

if (parentPort) {
    analyzeChunkGroup(workerData.chunks);
}
