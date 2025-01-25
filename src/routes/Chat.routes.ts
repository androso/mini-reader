import { Router } from "express";
import { authenticate } from "../middleware/auth";

const router = Router();

/**
 * @swagger
 * /api/{resourceType}/{id}/conversations:
 *   post:
 *     tags:
 *       - Chat
 *     summary: Create a new conversation
 *     description: Create a new conversation
 *     parameters:
 *       - in: path
 *         name: resourceType
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Conversation created successfully"
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "No token provided or invalid token"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Internal server error"
 */
router.post("/:resourceType/:id/conversations", authenticate, (req, res) => {
    res.json({ message: "Conversation created successfully" });
});

/**
 * @swagger
 * /api/{resourceType}/{id}/conversations:
 *  get:
 *    tags:
 *      - Chat
 *    parameters:
 *      - in: path
 *        name: resourceType
 *        required: true
 *        schema:
 *          type: string
 *      - in: path
 *        name: id
 *        required: true
 *        schema:
 *          type: string
 *    summary: Get chat history of a book
 *    description: Get chat history of a book
 *    security:
 *      - bearerAuth: []
 *    responses:
 *      200:
 *        description: Chat conversations of a book
 *        content:
 *          application/json:
 *            schema:
 *              type: array
 *              items:
 *                type: object
 *                properties:
 *                  conversationId:
 *                    type: string
 *                    example: "123"
 *                  conversationName:
 *                    type: string
 *                    example: "Book chat"
 *                  resourceId:
 *                    type: string
 *                    example: "book123"
 *                  userId:
 *                   type: string
 *                   example: "123"
 *                  createdAt:
 *                    type: string
 *                    format: date-time
 *      401:
 *        description: Unauthorized
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                message:
 *                  type: string
 *                  example: "No token provided or invalid token"
 *      500:
 *        description: Internal server error
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                error:
 *                  type: string
 *                  example: "Internal server error"
 */
router.get("/:resourceType/:id/conversations", authenticate, (req, res) => {
    res.json({ message: "Get Conversations successfully" });
});

/**
 * @swagger
 * /api/{resourceType}/{id}/conversations/{conversationId}:
 *  get:
 *    tags:
 *      - Chat
 *    summary: Get messages for a specific conversation
 *    parameters:
 *      - in: path
 *        name: resourceType
 *        required: true
 *        schema:
 *          type: string
 *      - in: path
 *        name: id
 *        required: true
 *        schema:
 *          type: string
 *      - in: path
 *        name: conversationId
 *        required: true
 *        schema:
 *          type: string
 *    security:
 *      - bearerAuth: []
 *    responses:
 *      200:
 *        description: Array of messages for the conversation
 *        content:
 *          application/json:
 *            schema:
 *              type: array
 *              items:
 *                type: object
 *                properties:
 *                  messageId:
 *                    type: string
 *                    example: "msg123"
 *                  conversationId:
 *                    type: string
 *                    example: "conv123"
 *                  role:
 *                    type: string
 *                    example: "User | Assistant"
 *                  message:
 *                    type: string
 *                    example: "message content"
 *                  createdAt:
 *                    type: string
 *                    format: date-time
 *      401:
 *        description: Unauthorized
 *      404:
 *        description: Conversation not found
 */
router.get("/:resourceType/:id/conversations/:id", authenticate, (req, res) => {
    res.json({
        message: "returns data info of specific conversation and messages",
    });
});

/**
 * @swagger
 * /api/{resourceType}/{id}/conversations/{conversationId}/messages:
 *   post:
 *     tags:
 *       - Chat
 *     summary: Create a new message
 *     description: Create a new message
 *     parameters:
 *       - in: path
 *         name: resourceType
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 example: "message content"
 *               role:
 *                 type: string
 *                 example: "User | Assistant"
 *     responses:
 *       200:
 *         description: Message created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Message created successfully"
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "No token provided or invalid token"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Internal server error"
 */
router.post(
    "/:resourceType/:id/conversations/:id/messages",
    authenticate,
    (req, res) => {
        res.json({ message: "user and assistant messages" });
    }
);

export default router;
