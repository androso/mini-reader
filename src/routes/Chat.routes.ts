import { eq } from "drizzle-orm";
import { db } from "../db";
import { Conversations, Messages } from "../db/schema";
import { authenticate } from "../middleware/auth";
import { OpenAIService } from "../services/OpenAIServices";
import { Router, Request } from "express";

const router = Router();
const oaiService = new OpenAIService();

router.post(
    "/:resourceType/:id/conversations",
    authenticate,
    async (req: Request, res) => {
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
                        userId: "4cf48fc5-36d1-429c-aec1-6d1b24857fdd",
                        // userId: req.user.id,
                        title: message.substring(0, 50) + "...",
                        resourceType: req.params.resourceType,
                        resourceId: req.params.id,
                    })
                    .returning();
                // create message
                await db.insert(Messages).values({
                    conversationId: conversation.id,
                    role: "user",
                    content: message,
                });
                const textStream =
                    await oaiService.generateStreamResponse(message);

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
                // return the conversation Id
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
    }
);

router.get(
    "/:resourceType/:id/conversations",
    authenticate,
    async (req: Request, res) => {
        const conversations = await db
            .select()
            .from(Conversations)
            .where(
                eq(Conversations.userId, "4cf48fc5-36d1-429c-aec1-6d1b24857fdd")
            );
        res.send({
            conversations,
        });
    }
);

router.post(
    "/:resourceType/:rid/conversations/:cid/messages",
    authenticate,
    async (req, res) => {
        const {
            resourceType,
            rid: resourceId,
            cid: conversationId,
        } = req.params;
        if (!resourceType || !resourceId || !conversationId) {
            res.status(400).send({
                error: "Invalid request",
            });
            return;
        }
        const { role, message } = req.body;

        await db.insert(Messages).values({
            conversationId,
            role,
            content: message,
        });

        const textStream = await oaiService.generateStreamResponse(message);
        let accumulatedResponse = "";
        for await (const chunk of textStream) {
            const content = chunk.choices[0]?.delta?.content || "";
            accumulatedResponse += content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
        await db.insert(Messages).values({
            conversationId,
            role: "assistant",
            content: accumulatedResponse,
        });
        res.write("data: [DONE]\n\n");
        res.send();
    }
);

router.get(
    "/:resourceType/:id/conversations/:conversationId",
    authenticate,
    async (req: Request, res) => {
        const conversationId = req.params.conversationId;
        const [conversation] = await db
            .select()
            .from(Conversations)
            .where(eq(Conversations.id, conversationId));
        if (!conversation) {
            res.status(404).send({
                error: "Conversation not found",
            });
            return;
        }
        const messages = await db
            .select()
            .from(Messages)
            .where(eq(Messages.conversationId, conversationId));

        res.send({
            messages,
        });
    }
);

export default router;
