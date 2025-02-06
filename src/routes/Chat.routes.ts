import { desc, eq } from "drizzle-orm";
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
        if (
            req.params.resourceType !== "book" &&
            req.params.resourceType !== "article"
        ) {
            res.status(400).send({
                error: "Invalid resource type",
            });
            return;
        }

        try {
            const { message, messages } = req.body;
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

            res.write(
                `data: ${JSON.stringify({ type: "conversation_id", conversationId: conversation.id })}\n\n`
            );

            await db.insert(Messages).values({
                conversationId: conversation.id,
                role: "user",
                content: message,
            });

            const textStream =
                await oaiService.generateStreamResponse(messages);

            let accumulatedResponse = "";
            for await (const chunk of textStream) {
                if (res.writableEnded) break;
                const content = chunk.choices[0]?.delta?.content || "";
                accumulatedResponse += content;
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }

            if (!res.writableEnded) {
                await db.insert(Messages).values({
                    conversationId: conversation.id,
                    role: "assistant",
                    content: accumulatedResponse,
                });
                res.write("data: [DONE]\n\n");
                res.end();
            }
        } catch (e) {
            console.error("Error in chat stream", e);
            if (!res.writableEnded) {
                res.write(
                    `data: ${JSON.stringify({ error: "An error occurred" })}\n\n`
                );
                res.end();
            }
        }
    }
);

router.get(
    "/:resourceType/:id/conversations",
    authenticate,
    async (req: Request, res) => {
        try {
            const conversations = await db
                .select()
                .from(Conversations)
                .where(eq(Conversations.userId, req.user.id))
                .orderBy(desc(Conversations.lastMessageAt));
            res.status(200).send({
                conversations,
            });
        } catch (error) {
            console.error("Error fetching conversations", error);
            if (!res.headersSent) {
                res.status(500).send({
                    error: "An error occurred while fetching conversations",
                });
            }
        }
    }
);

router.post(
    "/:resourceType/:rid/conversations/:cid/messages",
    authenticate,
    async (req, res) => {
        console.log("Middleware authenticated and route handler called.");

        try {
            const {
                resourceType,
                rid: resourceId,
                cid: conversationId,
            } = req.params;
            console.log("Route parameters extracted:", req.params);
            if (!resourceType || !resourceId || !conversationId) {
                console.log("Invalid request due to missing parameters.");
                res.status(400).send({
                    error: "Invalid request",
                });
                return;
            }

            const { messages } = req.body;
            console.log("Request body received:", req.body);
            if (!Array.isArray(messages) || messages.length === 0) {
                console.log("Invalid request due to empty messages array.");
                res.status(400).send({
                    error: "Messages array is required",
                });
                return;
            }

            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            console.log("Response headers set for SSE.");

            const lastMessage = messages[messages.length - 1];
            await db.insert(Messages).values({
                conversationId,
                role: lastMessage.role,
                content: lastMessage.content,
            });
            console.log("Last message inserted into database:", lastMessage);

            const textStream =
                await oaiService.generateStreamResponse(messages);
            let accumulatedResponse = "";
            console.log("Stream response generation initiated.");

            for await (const chunk of textStream) {
                if (res.writableEnded) break;
                const content = chunk.choices[0]?.delta?.content || "";
                accumulatedResponse += content;
                console.log("Chunk received:", chunk);
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }

            if (!res.writableEnded) {
                await db.insert(Messages).values({
                    conversationId,
                    role: "assistant",
                    content: accumulatedResponse,
                });
                console.log(
                    "Response written to database:",
                    accumulatedResponse
                );
                res.write("data: [DONE]\n\n");
                res.end();
            }
        } catch (error) {
            console.error("Error in chat messages", error);
            if (!res.writableEnded) {
                res.write(
                    `data: ${JSON.stringify({ error: "An error occurred" })}\n\n`
                );
                res.end();
            }
        }
    }
);

router.get(
    "/:resourceType/:id/conversations/:conversationId",
    authenticate,
    async (req: Request, res) => {
        try {
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
                .where(eq(Messages.conversationId, conversationId))
                .orderBy(Messages.createdAt);

            res.send({
                messages,
            });
        } catch (error) {
            console.error("Error fetching conversation details", error);
            if (!res.headersSent) {
                res.status(500).send({
                    error: "An error occurred while retrieving conversation details",
                });
            }
        }
    }
);

export default router;
