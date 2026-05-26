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

    async generateStreamResponse(
        userMessages: any,
        systemPrompt = "You are a helpful assistant."
    ): Promise<any> {
        console.log({ userMessages });
        const response = await this.client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: systemPrompt,
                    name: "system",
                },
                ...userMessages,
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
}
