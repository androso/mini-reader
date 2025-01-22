import { Router } from "express";
import { authenticate } from "../middleware/auth";

const router = Router();

/**
 * @swagger
 * /api/{resourceType}/{id}/threads:
 *   post:
 *     tags:
 *       - Chat
 *     summary: Create a new thread
 *     description: Create a new thread
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
 *         description: Thread created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Thread created successfully"
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
router.post("/:resourceType/:id/threads", authenticate, (req, res) => {
    res.json({ message: "Thread created successfully" });  
})
/**
 * @swagger
 * /api/{resourceType}/{id}/threads:
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
 *        description: Chat thread of a book
 *        content:
 *          application/json:
 *            schema:
 *              type: array
 *              items:
 *                type: object
 *                properties:
 *                  threadId:
 *                    type: string
 *                    example: "123"
 *                  threadName:
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
// when a user pick some file to read, retrieve all threads (id) of that book and user id
//return array with all threads of a book and user id
router.get("/:resourceType/:id/threads", authenticate, (req, res) => {
    res.json({ message: "Get Threads successfully" });  
})

/**
 * @swagger
 * /api/{resourceType}/{id}/threads/{threadId}:
 *  get:
 *    tags:
 *      - Chat
 *    summary: Get messages for a specific thread
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
 *        name: threadId
 *        required: true
 *        schema:
 *          type: string
 *    security:
 *      - bearerAuth: []
 *    responses:
 *      200:
 *        description: Array of messages for the thread
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
 *                  threadId:
 *                    type: string
 *                    example: "thread123"
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
 *        description: Thread not found
 */
//return data info of specific thread and messages of that thread
router.get("/:resourceType/:id/threads/:id", authenticate, (req, res) => {
    res.json({ message: "returns data info of specific thread and messages" });  
})
/**
 * @swagger
 * /api/{resourceType}/{id}/threads/{threadId}/messages:
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
 *         name: threadId
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
router.post("/:resourceType/:id/threads/:id/messages", authenticate, (req, res) => {
    res.json({ message: "user and assitant messages" });  
})

export default router