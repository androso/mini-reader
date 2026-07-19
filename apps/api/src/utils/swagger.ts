import path from "node:path";
import doc from "swagger-jsdoc";
import ui from "swagger-ui-express";
import type { Express, Request, Response } from "express";

export const resolveSwaggerRouteGlob = (utilsDirectory = __dirname) =>
    path.resolve(utilsDirectory, "../routes/*.{ts,js}");

const definition = {
    openapi: "3.0.0",
    info: {
        title: "Reader API",
        version: "1.0.0",
        description:
            "API for the compact Reader fork. Browser sessions use an HttpOnly cookie; book storage identifiers and chat execution metadata are private.",
    },
    servers: [{ url: "/", description: "Current Reader origin" }],
    security: [{ readerSession: [] }],
    components: {
        securitySchemes: {
            readerSession: {
                type: "apiKey",
                in: "cookie",
                name: "__Host-reader_session",
                description:
                    "Production HttpOnly session cookie. Development uses reader_session without Secure.",
            },
        },
        schemas: {
            User: {
                type: "object",
                required: ["id", "name", "email", "createdAt", "updatedAt"],
                properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    email: { type: "string", format: "email" },
                    image: { type: "string", nullable: true },
                    googleId: { type: "string", nullable: true },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" },
                },
            },
            PublicBook: {
                type: "object",
                required: [
                    "id",
                    "title",
                    "fileType",
                    "processingStatus",
                    "processingError",
                    "createdAt",
                ],
                properties: {
                    id: { type: "string", format: "uuid" },
                    title: { type: "string" },
                    fileType: {
                        type: "string",
                        nullable: true,
                        enum: ["epub", "pdf"],
                    },
                    processingStatus: {
                        type: "string",
                        enum: [
                            "processing",
                            "ready",
                            "failed",
                            "queue_failed",
                            "deleting",
                        ],
                    },
                    processingError: { type: "string", nullable: true },
                    createdAt: { type: "string", format: "date-time" },
                },
            },
            BookStatus: {
                type: "object",
                required: ["bookId", "fileType", "ready", "status", "error"],
                properties: {
                    bookId: { type: "string", format: "uuid" },
                    fileType: {
                        type: "string",
                        nullable: true,
                        enum: ["epub", "pdf"],
                    },
                    ready: { type: "boolean" },
                    status: { type: "string" },
                    error: { type: "string", nullable: true },
                },
            },
            Progress: {
                type: "object",
                required: ["progressPosition"],
                properties: {
                    progressPosition: { type: "string", nullable: true },
                    progressChapter: { type: "string", nullable: true },
                },
            },
            ContextSource: {
                type: "object",
                required: ["id", "chunkIndex", "score", "bestRank", "excerpt"],
                properties: {
                    id: { type: "string" },
                    chunkIndex: { type: "integer" },
                    score: { type: "number" },
                    bestRank: { type: "integer" },
                    excerpt: { type: "string" },
                },
            },
            PublicMessage: {
                type: "object",
                required: [
                    "id",
                    "conversationId",
                    "role",
                    "content",
                    "contextSources",
                    "completionStatus",
                    "finishReason",
                    "createdAt",
                ],
                properties: {
                    id: { type: "string", format: "uuid" },
                    conversationId: { type: "string", format: "uuid" },
                    role: { type: "string", enum: ["user", "assistant"] },
                    content: { type: "string" },
                    contextSources: {
                        type: "array",
                        nullable: true,
                        items: { $ref: "#/components/schemas/ContextSource" },
                    },
                    completionStatus: {
                        type: "string",
                        nullable: true,
                        enum: ["complete", "truncated", "cancelled", "failed"],
                    },
                    finishReason: { type: "string", nullable: true },
                    createdAt: { type: "string", format: "date-time" },
                },
            },
            ChatRequest: {
                type: "object",
                required: ["message"],
                description:
                    "Only these fields are used. Client-supplied roles and transcripts are ignored.",
                properties: {
                    message: { type: "string", minLength: 1, maxLength: 8000 },
                    model: { type: "string" },
                    highlightContext: {
                        type: "object",
                        nullable: true,
                        required: ["sourceType", "text"],
                        properties: {
                            sourceType: { type: "string", enum: ["epub"] },
                            text: { type: "string", maxLength: 4000 },
                        },
                    },
                },
            },
            ChatTerminalEvent: {
                type: "object",
                required: ["type", "status", "finishReason"],
                properties: {
                    type: { type: "string", enum: ["terminal"] },
                    status: {
                        type: "string",
                        enum: ["complete", "truncated", "cancelled", "failed"],
                    },
                    finishReason: { type: "string", nullable: true },
                },
            },
            Error: {
                type: "object",
                properties: {
                    error: { type: "string" },
                    message: { type: "string" },
                },
            },
        },
    },
};

export const createOpenApiSpec = (routeGlob = resolveSwaggerRouteGlob()) =>
    doc({
        definition,
        apis: [routeGlob],
    });

export const openApiSpec = createOpenApiSpec();

const swaggerdocs = (app: Express) => {
    app.get("/api-docs.json", (_req: Request, res: Response) => {
        res.json(openApiSpec);
    });
    app.use("/api-docs", ui.serve, ui.setup(openApiSpec));
};

export default swaggerdocs;
