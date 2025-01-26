import { db } from "../db";
import { Conversations, Messages } from "../db/schema";
import { OpenAIService } from "../services/OpenAIServices";
import { Router } from "express";
const router = Router();

router.post("/:resourceType/:id/conversations/stream", async (req, res) => {
    const { message } = req.body;
    if (
        req.params.resourceType === "book" ||
        req.params.resourceType === "article"
    ) {
        try {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");

            const [conversation] = await db
                .insert(Conversations)
                .values({
                    userId: req.user.id,
                    title: message.substring(0, 50) + "...",
                    resourceType: req.params.resourceType,
                    resourceId: req.params.id,
                })
                .returning();
            shell;
            // create message
            await db.insert(Messages).values({
                conversationId: conversation.id,
                role: "user",
                content: message,
            });
            const oaiService = new OpenAIService();
            const textStream = await oaiService.generateStreamResponse(message);

            let accumulatedResponse = "";
            for await (const chunk of textStream) {
                const content = chunk.choices[0]?.delta?.content || "";
                accumulatedResponse += content;

                // Send chunk to client
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
            await db.insert(Messages).values({
                conversationId: conversation.id,
                role: "assistant",
                content: accumulatedResponse,
            });
            res.write("data: [DONE]\n\n");
            res.send();
        } catch (e) {
            console.error("Error in chat stream", e);
            res.write(
                `data: ${JSON.stringify({ error: "An error occurred" })}\n\n`
            );
        }
    } else {
        res.status(400).send({
            error: "Invalid resource type",
        });
    }
});

export default router;
