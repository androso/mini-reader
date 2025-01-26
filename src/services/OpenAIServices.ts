import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

export class OpenAIService {
    private client: OpenAI;

    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    async generateStreamResponse(query: string): Promise<any> {
        const response = await this.client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant.",
                },
                {
                    role: "user",
                    content: query,
                },
            ],
            temperature: 0.7,
            max_tokens: 300,
            stream: true,
        });
        return response;
    }
    async generateResponse(context: string, query: string): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: "gpt-4o-mini-2024-07-18",
            messages: [
                {
                    role: "system",
                    content:
                        "You are a helpful assistant. Answer the question based on the provided context.",
                },
                {
                    role: "user",
                    content: `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer:`,
                },
            ],
            temperature: 0.7,
            max_tokens: 300,
        });

        return response.choices[0].message.content || "";
    }

    // New method specifically for analyzing text chunks
    async analyzeChunks(chunks: string[]): Promise<number[]> {
        console.log("[OpenAIService] Starting chunk analysis");
        console.log(`[OpenAIService] Analyzing ${chunks.length} chunks`);

        try {
            if (!chunks.length) {
                console.log("[OpenAIService] No chunks to analyze");
                return [];
            }

            const chunkedText = chunks
                .map((chunk, index) => `Chunk ${index + 1}:\n${chunk}\n---\n`)
                .join("\n");

            console.log("[OpenAIService] Sending request to OpenAI");
            const response = await this.client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `"You are an assistant specialized in splitting text into thematically consistent sections. "
                    "The text has been divided into chunks, each marked with <|start_chunk_X|> and <|end_chunk_X|> tags, where X is the chunk number. "
                    "Your task is to identify the points where splits should occur, such that consecutive chunks of similar themes stay together. "
                    "Respond with a list of chunk IDs where you believe a split should be made. For example, if chunks 1 and 2 belong together but chunk 3 starts a new topic, you would suggest a split after chunk 2. THE CHUNKS MUST BE IN ASCENDING ORDER."
                    "Your response should be in the form: 'split_after: 3, 5'."`,
                    },
                    {
                        role: "user",
                        content: chunkedText,
                    },
                ],
                temperature: 0.3,
                max_tokens: 200,
            });

            console.log("[OpenAIService] Received response from OpenAI");
            const result = response.choices[0]?.message?.content || "";
            console.log(`[OpenAIService] Raw response: ${result}`);

            const splits = result.toLowerCase().includes("split_after:")
                ? result
                      .split("split_after:")[1]
                      .match(/\d+/g)
                      ?.map((num) => parseInt(num))
                      .filter((num) => !isNaN(num) && num <= chunks.length) ||
                  []
                : [];

            console.log(
                `[OpenAIService] Parsed split points: ${splits.join(", ")}`
            );
            return splits;
        } catch (error) {
            console.error("[OpenAIService] Error analyzing chunks:", error);
            return [];
        }
    }
}
