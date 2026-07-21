import path from "node:path";
import doc from "swagger-jsdoc";
import ui from "swagger-ui-express";
import type { Express, Request, Response } from "express";
import { DEV_AUTH_COOKIE, PROD_AUTH_COOKIE } from "./authCookie";

export const resolveSwaggerRouteGlob = (utilsDirectory = __dirname) =>
    path.resolve(utilsDirectory, "../routes/*.{ts,js}");

export type OpenApiSpecOptions = {
    routeGlob?: string;
    nodeEnv?: string;
};

export const getOpenApiCookieName = (
    nodeEnv: string | undefined = process.env.NODE_ENV
) => (nodeEnv === "production" ? PROD_AUTH_COOKIE : DEV_AUTH_COOKIE);

const createDefinition = (
    nodeEnv: string | undefined = process.env.NODE_ENV
) => {
    const cookieName = getOpenApiCookieName(nodeEnv);
    const alternateCookieName =
        cookieName === PROD_AUTH_COOKIE ? DEV_AUTH_COOKIE : PROD_AUTH_COOKIE;

    return {
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
                    name: cookieName,
                    description: `${nodeEnv === "production" ? "Production" : "Development"} HttpOnly session cookie. The alternate environment uses ${alternateCookieName}.`,
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
                        username: { type: "string", nullable: true },
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
                    required: [
                        "bookId",
                        "fileType",
                        "ready",
                        "status",
                        "error",
                    ],
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
                    required: [
                        "id",
                        "chunkIndex",
                        "score",
                        "bestRank",
                        "excerpt",
                    ],
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
                            items: {
                                $ref: "#/components/schemas/ContextSource",
                            },
                        },
                        completionStatus: {
                            type: "string",
                            nullable: true,
                            enum: [
                                "complete",
                                "truncated",
                                "cancelled",
                                "failed",
                            ],
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
                        message: {
                            type: "string",
                            minLength: 1,
                            maxLength: 8000,
                        },
                        model: {
                            type: "string",
                            enum: [
                                "gpt-4o-mini",
                                "gpt-5.5-2026-04-23",
                                "gpt-5.4-mini-2026-03-17",
                            ],
                            default: "gpt-4o-mini",
                            description:
                                "Optional model override. Unsupported values return 400.",
                        },
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
                            enum: [
                                "complete",
                                "truncated",
                                "cancelled",
                                "failed",
                            ],
                        },
                        finishReason: { type: "string", nullable: true },
                    },
                },
                ChatConversationEvent: {
                    type: "object",
                    required: ["type", "conversationId"],
                    properties: {
                        type: { type: "string", enum: ["conversation_id"] },
                        conversationId: { type: "string", format: "uuid" },
                    },
                },
                ChatContentEvent: {
                    type: "object",
                    required: ["content"],
                    properties: { content: { type: "string" } },
                },
                ChatSourcesEvent: {
                    type: "object",
                    required: ["type", "sources"],
                    properties: {
                        type: { type: "string", enum: ["sources"] },
                        sources: {
                            type: "array",
                            items: {
                                $ref: "#/components/schemas/ContextSource",
                            },
                        },
                    },
                },
                ChatContextErrorEvent: {
                    type: "object",
                    required: ["error", "status"],
                    properties: {
                        error: { type: "string" },
                        status: {
                            type: "string",
                            enum: [
                                "processing",
                                "not_found",
                                "ingestion_failed",
                                "retrieval_unavailable",
                            ],
                        },
                    },
                },
                ChatFatalErrorEvent: {
                    description:
                        "Fatal error after SSE headers were sent. The server closes the stream after this event without a terminal event or [DONE] sentinel.",
                    type: "object",
                    required: ["error"],
                    properties: {
                        error: { type: "string", enum: ["An error occurred"] },
                    },
                },
                ChatStreamEvent: {
                    description:
                        "JSON payload from an SSE data frame. Normal streams end with a terminal event and the literal data sentinel [DONE]. A fatal error after headers were sent emits ChatFatalErrorEvent and closes without terminal or [DONE].",
                    oneOf: [
                        { $ref: "#/components/schemas/ChatConversationEvent" },
                        { $ref: "#/components/schemas/ChatContentEvent" },
                        { $ref: "#/components/schemas/ChatSourcesEvent" },
                        { $ref: "#/components/schemas/ChatContextErrorEvent" },
                        { $ref: "#/components/schemas/ChatFatalErrorEvent" },
                        { $ref: "#/components/schemas/ChatTerminalEvent" },
                    ],
                },
                Error: {
                    type: "object",
                    properties: {
                        error: { type: "string" },
                        message: { type: "string" },
                    },
                },
            },
            responses: {
                InternalError: {
                    description: "Unexpected internal server error",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
            },
        },
    };
};

export const createOpenApiSpec = ({
    routeGlob = resolveSwaggerRouteGlob(),
    nodeEnv = process.env.NODE_ENV,
}: OpenApiSpecOptions = {}) =>
    doc({
        definition: createDefinition(nodeEnv),
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
