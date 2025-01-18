import { Router } from "express";
import { authenticate } from "../middleware/auth";

const router = Router();

/**
 * @swagger
 * /api/chats:
 *  get:
 *    tags:
 *      - Chat
 *    summary: Get chat history of a book
 *    description: Get chat history of a book
 *    security:
 *      - bearerAuth: []
 *    responses:
 *      200:
 *        description: Chat history of a book
 *        content:
 *          application/json:
 *            schema:
 *              type: array
 *              items:
 *                type: object
 *                properties:
 *                  id:
 *                    type: string
 *                    example: "123"
 *                  userId:
 *                    type: string
 *                    example: "user123"
 *                  bookId:
 *                    type: string
 *                    example: "book123"
 *                  query:
 *                    type: string
 *                    example: "What is this book about?"
 *                  response:
 *                    type: string
 *                    example: "This book is about..."
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
//this is the chat history of a book
router.get("/", authenticate, (req, res) => {
    res.json({ message: "Chat history created successfully" });  
})

/**
 * @swagger
 * /api/chats/{id}:
 *  get:
 *    tags:
 *      - Chat
 *    summary: Get specific chat by ID
 *    parameters:
 *      - in: path
 *        name: id
 *        required: true
 *        schema:
 *          type: string
 *    security:
 *      - bearerAuth: []
 *    responses:
 *      200:
 *        description: Chat details
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                id:
 *                  type: string
 *                userId:
 *                  type: string
 *                bookId:
 *                  type: string
 *                query:
 *                  type: string
 *                response:
 *                  type: string
 *                createdAt:
 *                  type: string
 *                  format: date-time
 *      404:
 *        description: Chat not found
 */
//specific chat in chat history of a book
router.get("/:id", authenticate, (req, res) => {
    res.json({ message: "Chat created successfully" });  
})

export default router