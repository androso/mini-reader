import { and, asc, desc, eq } from "drizzle-orm";
import { createLogger } from "@reader/providers";
import { db } from "../db";
import {
    Books,
    Conversations,
    Messages,
    type MessageContextSource,
    type MessageExecutionMetadata,
} from "../db/schema";
import { authenticate } from "../middleware/auth";
import { chatRateLimit } from "../middleware/rateLimit";
import { asyncHandler } from "../middleware/asyncHandler";
import {
    OPENAI_CHAT_MAX_TOKENS,
    OPENAI_CHAT_MODEL,
    OPENAI_CHAT_TEMPERATURE,
    OpenAIService,
    type ChatMessage,
    type OpenAIChatModel,
    isOpenAIChatModel,
} from "../services/OpenAIServices";
import {
    buildBookContextSystemPrompt,
    buildRetrievalQuery,
    normalizeHighlightContext,
    type HighlightContext,
} from "../services/HighlightContext";
import { Router, Request, Response } from "express";
import { hybridBookSearchService } from "../services/HybridBookSearchService";
import {
    getLangfuseCaptureConfig,
    getNoopTraceObservation,
    recordObservationError,
    snippetForLangfuse,
    withBookChatTrace,
    type TraceObservation,
} from "../observability/langfuse";
import {
    runAuthorizedChatResourceOperation,
    runAuthorizedScopedChatConversationOperation,
    type SupportedChatResourceType,
} from "../services/ChatResourceAuthorization";
import {
    persistUserMessageAndBuildHistory,
    projectChatRequest,
    type ChatServerHistoryRepository,
} from "../services/ChatServerHistory";
import {
    classifyChatCompletionStatus,
    createResponseAbortController,
    isAbortError,
    type ChatCompletionOutcome,
    type MessageCompletionStatus,
} from "../services/ChatCompletionOutcome";
import {
    BOOK_CONTEXT_FAILURE_MESSAGES,
    NO_RELEVANT_BOOK_CONTEXT_RESPONSE,
    classifyStoredBookContext,
    type BookContextStatus,
} from "../services/BookContextState";
import {
    buildMessageExecutionMetadata,
    PUBLIC_MESSAGE_SELECTION,
} from "../services/ChatExecutionMetadata";

const router = Router();
const oaiService = new OpenAIService();
const log = createLogger("chat");

type StreamAssistantOutcome = ChatCompletionOutcome & {
    usage: unknown;
    generationDurationMs: number;
};

const chatResourceRepository = {
    findBookById: async (resourceId: string) => {
        const [book] = await db
            .select({ id: Books.id, userId: Books.userId })
            .from(Books)
            .where(eq(Books.id, resourceId));

        return book ?? null;
    },
};

const runAuthorizedRequestOperation = async <T>({
    resourceType,
    resourceId,
    userId,
    res,
    operation,
}: {
    resourceType: string;
    resourceId: string;
    userId: string;
    res: Response;
    operation: (resourceType: SupportedChatResourceType) => Promise<T>;
}) => {
    const result = await runAuthorizedChatResourceOperation({
        resourceType,
        resourceId,
        userId,
        repository: chatResourceRepository,
        operation,
    });

    if (!result.ok) {
        res.status(result.status).send({ error: result.error });
        return null;
    }

    return result.value;
};

const findScopedConversation = async ({
    conversationId,
    userId,
    resourceType,
    resourceId,
}: {
    conversationId: string;
    userId: string;
    resourceType: SupportedChatResourceType;
    resourceId: string;
}) => {
    const [conversation] = await db
        .select()
        .from(Conversations)
        .where(
            and(
                eq(Conversations.id, conversationId),
                eq(Conversations.userId, userId),
                eq(Conversations.resourceType, resourceType),
                eq(Conversations.resourceId, resourceId)
            )
        );

    return conversation ?? null;
};

const touchConversation = async (conversationId: string) => {
    await db
        .update(Conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(Conversations.id, conversationId));
};

const chatServerHistoryRepository: ChatServerHistoryRepository = {
    loadMessages: async (conversationId) =>
        db
            .select({
                id: Messages.id,
                role: Messages.role,
                content: Messages.content,
                createdAt: Messages.createdAt,
            })
            .from(Messages)
            .where(eq(Messages.conversationId, conversationId))
            .orderBy(asc(Messages.createdAt), asc(Messages.id)),
    insertUserMessage: async (conversationId, content) => {
        await db
            .insert(Messages)
            .values({ conversationId, role: "user", content });
    },
};

const runAuthorizedScopedRequestOperation = async <T>({
    resourceType,
    resourceId,
    conversationId,
    userId,
    res,
    operation,
}: {
    resourceType: string;
    resourceId: string;
    conversationId: string;
    userId: string;
    res: Response;
    operation: (
        conversation: typeof Conversations.$inferSelect,
        resourceType: SupportedChatResourceType
    ) => Promise<T>;
}) => {
    const result = await runAuthorizedScopedChatConversationOperation({
        resourceType,
        resourceId,
        conversationId,
        userId,
        repository: chatResourceRepository,
        findScopedConversation,
        operation,
    });

    if (!result.ok) {
        res.status(result.status).send({ error: result.error });
        return null;
    }

    return result.value;
};

const getErrorDetail = (error: unknown) => {
    if (!error || typeof error !== "object") return String(error);
    const details = error as {
        code?: unknown;
        errno?: unknown;
        message?: unknown;
        name?: unknown;
    };

    return [details.name, details.code, details.errno, details.message]
        .filter(Boolean)
        .join(" ");
};

const isPrematureCloseError = (error: unknown) =>
    getErrorDetail(error).includes("ERR_STREAM_PREMATURE_CLOSE") ||
    getErrorDetail(error).includes("Premature close");

const resolveChatModel = (model: unknown): OpenAIChatModel | null => {
    if (model === undefined || model === null || model === "") {
        return OPENAI_CHAT_MODEL;
    }

    return isOpenAIChatModel(model) ? model : null;
};

const summarizeRetrievedChunks = (
    results: Awaited<ReturnType<typeof hybridBookSearchService.search>>
) => {
    const capture = getLangfuseCaptureConfig();
    return results.map((result) => {
        const snippet = snippetForLangfuse(result.content, capture);
        return {
            id: result.id,
            chunkIndex: result.chunkIndex,
            score: result.score,
            bestRank: result.bestRank,
            ...(snippet ? { snippet } : {}),
        };
    });
};

const buildContextSources = (
    results: Awaited<ReturnType<typeof hybridBookSearchService.search>>
): MessageContextSource[] =>
    results.map((result) => ({
        id: result.id,
        chunkIndex: result.chunkIndex,
        score: result.score,
        bestRank: result.bestRank,
        excerpt: result.content,
    }));

const buildRagMessages = async (
    resourceType: string,
    resourceId: string,
    userId: string,
    messages: ChatMessage[],
    query: string,
    highlightContext: HighlightContext | null = null,
    trace: TraceObservation = getNoopTraceObservation()
): Promise<{
    messages: ChatMessage[];
    status: BookContextStatus;
    sources: MessageContextSource[] | null;
}> => {
    log.debug("Building RAG messages", {
        resourceType,
        resourceId,
        userId,
        query: query.slice(0, 200),
    });
    if (resourceType !== "book") {
        log.debug("Non-book resource, skipping retrieval", {
            resourceType,
            resourceId,
        });
        return {
            messages,
            status: "retrieval_unavailable",
            sources: null,
        };
    }

    const loadBookSpan = trace.startObservation("load_book", {
        input: {
            resourceType,
            resourceId,
        },
    });
    let book: typeof Books.$inferSelect | undefined;
    try {
        [book] = await db
            .select()
            .from(Books)
            .where(and(eq(Books.id, resourceId), eq(Books.userId, userId)));
        loadBookSpan.update({
            output: {
                found: Boolean(book),
                processingStatus: book?.processingStatus,
                hasCollection: Boolean(book?.collectionName),
                collectionName: book?.collectionName,
            },
        });
    } catch (error) {
        recordObservationError(loadBookSpan, error, "Book lookup failed");
        log.error("Book lookup failed while retrieving context", {
            resourceId,
            userId,
        });
        return {
            messages,
            status: "retrieval_unavailable",
            sources: null,
        };
    } finally {
        loadBookSpan.end();
    }

    const contextState = classifyStoredBookContext(book);
    if (contextState !== "ready") {
        log.info("Book context is not ready for retrieval", {
            resourceId,
            userId,
            contextState,
        });
        return { messages, status: contextState, sources: null };
    }
    if (!book?.collectionName) {
        return { messages, status: "retrieval_unavailable", sources: null };
    }
    const collectionName = book.collectionName;

    try {
        log.info("Retrieving book context", {
            resourceId,
            userId,
            collectionName,
        });
        const start = Date.now();
        const retrievalSpan = trace.startObservation("hybrid_retrieval", {
            input: {
                collectionName,
                queryLength: query.length,
                lexicalLimit: 20,
                vectorLimit: 20,
                finalLimit: 5,
            },
        });
        let searchResults: Awaited<
            ReturnType<typeof hybridBookSearchService.search>
        >;
        try {
            searchResults = await hybridBookSearchService.search(
                collectionName,
                query,
                {},
                {
                    trace: retrievalSpan,
                    capture: getLangfuseCaptureConfig(),
                }
            );
        } catch (error) {
            recordObservationError(
                retrievalSpan,
                error,
                "Hybrid retrieval failed"
            );
            throw error;
        } finally {
            retrievalSpan.end();
        }
        const relevantResults = searchResults.filter(
            (result) => result.content.trim().length > 0
        );
        const documents = relevantResults.map((result) => result.content);
        const duration = Date.now() - start;
        log.info("Book context retrieved", {
            resourceId,
            collectionName,
            retrievedChunkCount: documents.length,
            durationMs: duration,
        });

        if (!documents.length) {
            log.warn("No relevant chunks retrieved", {
                resourceId,
                collectionName,
            });
            return { messages, status: "no_relevant_context", sources: null };
        }

        const sources = buildContextSources(relevantResults);
        const promptSpan = trace.startObservation("build_rag_prompt", {
            input: {
                retrievedChunkCount: documents.length,
                baseMessageCount: messages.length,
            },
        });
        const context = documents.join("\n\n---\n\n");
        log.debug("Constructed context for LLM", {
            resourceId,
            contextLength: context.length,
        });
        promptSpan.update({
            output: {
                contextLength: context.length,
                messageCount: messages.length + 1,
                selectedChunks: summarizeRetrievedChunks(relevantResults),
            },
        });
        promptSpan.end();
        return {
            status: "ready",
            sources,
            messages: [
                {
                    role: "system" as const,
                    content: buildBookContextSystemPrompt(
                        context,
                        highlightContext
                    ),
                },
                ...messages,
            ],
        };
    } catch (error) {
        log.error("Error retrieving book context", {
            resourceId,
            collectionName,
        });
        return {
            messages,
            status: "retrieval_unavailable",
            sources: null,
        };
    }
};

const writeContextFailureAndEnd = (
    res: Response,
    status: Exclude<BookContextStatus, "ready" | "no_relevant_context">
) => {
    res.write(
        `data: ${JSON.stringify({
            error: BOOK_CONTEXT_FAILURE_MESSAGES[status],
            status,
        })}\n\n`
    );
    res.write(
        `data: ${JSON.stringify({
            type: "terminal",
            status: "failed",
            finishReason: status,
        })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
};

const streamAssistantResponse = async ({
    messages,
    res,
    trace,
    userId,
    conversationId,
    resourceType,
    resourceId,
    routeName,
    model,
    traceOpenAI,
    responseAbort,
}: {
    messages: ChatMessage[];
    res: Response;
    trace: TraceObservation;
    userId: string;
    conversationId: string;
    resourceType: string;
    resourceId: string;
    routeName: string;
    model: OpenAIChatModel;
    traceOpenAI: boolean;
    responseAbort: ReturnType<typeof createResponseAbortController>;
}) => {
    const generationStartedAt = Date.now();
    const openAiSpan = trace.startObservation("openai_chat_stream", {
        input: {
            model,
            temperature: OPENAI_CHAT_TEMPERATURE,
            maxTokens: OPENAI_CHAT_MAX_TOKENS,
            messageCount: messages.length,
        },
    });

    let accumulatedResponse = "";
    let finishReason: string | null = null;
    let usage: unknown = null;
    let streamFailed = false;
    let caughtAbortError = false;

    try {
        const textStream = await oaiService.generateStreamResponse(
            messages,
            undefined,
            {
                model,
                signal: responseAbort.controller.signal,
                ...(traceOpenAI
                    ? {
                          langfuse: {
                              userId,
                              sessionId: conversationId,
                              generationName: "openai_chat_completion",
                              tags: ["reader-api", "book-chat", routeName],
                              generationMetadata: {
                                  routeName,
                                  resourceType,
                                  resourceId,
                                  conversationId,
                                  model,
                              },
                              parentSpanContext: openAiSpan.getSpanContext(),
                          },
                      }
                    : {}),
            }
        );

        for await (const chunk of textStream) {
            if (responseAbort.wasClosed() || res.destroyed || res.writableEnded)
                break;
            const choice = chunk.choices[0];
            if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
            }
            if ("usage" in chunk && chunk.usage) {
                usage = chunk.usage;
            }
            const content = choice?.delta?.content || "";
            accumulatedResponse += content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }

        openAiSpan.update({
            output: {
                outputLength: accumulatedResponse.length,
                finishReason,
                usage,
            },
        });
    } catch (streamError) {
        caughtAbortError = isAbortError(streamError);
        const completedBeforeTransportWarning =
            (finishReason === "stop" || finishReason === "length") &&
            isPrematureCloseError(streamError);

        if (
            !responseAbort.wasClosed() &&
            !caughtAbortError &&
            !completedBeforeTransportWarning
        ) {
            streamFailed = true;
            recordObservationError(
                openAiSpan,
                streamError,
                "OpenAI chat stream failed"
            );
        } else if (completedBeforeTransportWarning) {
            openAiSpan.update({
                level: "WARNING",
                statusMessage: "Premature close after completed chat stream",
                output: {
                    outputLength: accumulatedResponse.length,
                    finishReason,
                    transportWarning: getErrorDetail(streamError),
                    usage,
                },
            });
            log.warn("Ignoring premature close after completed chat stream", {
                conversationId,
                error: getErrorDetail(streamError),
            });
        }
    } finally {
        openAiSpan.end();
    }

    return {
        content: accumulatedResponse,
        status: classifyChatCompletionStatus({
            finishReason,
            aborted:
                responseAbort.wasClosed() ||
                res.destroyed ||
                responseAbort.controller.signal.aborted ||
                caughtAbortError,
            failed: streamFailed,
        }),
        finishReason,
        usage,
        generationDurationMs: Date.now() - generationStartedAt,
    } satisfies StreamAssistantOutcome;
};

const saveAssistantMessage = async (
    conversationId: string,
    content: string,
    contextSources: MessageContextSource[] | null,
    completionStatus: MessageCompletionStatus,
    finishReason: string | null,
    executionMetadata: MessageExecutionMetadata,
    trace: TraceObservation
) => {
    const saveSpan = trace.startObservation("save_assistant_message", {
        input: {
            conversationId,
            responseLength: content.length,
            sourceCount: contextSources?.length ?? 0,
        },
    });

    try {
        await db.insert(Messages).values({
            conversationId,
            role: "assistant",
            content,
            contextSources,
            completionStatus,
            finishReason,
            executionMetadata,
        });
        await touchConversation(conversationId);
        saveSpan.update({
            output: {
                saved: true,
                responseLength: content.length,
                sourceCount: contextSources?.length ?? 0,
            },
        });
    } catch (error) {
        recordObservationError(
            saveSpan,
            error,
            "Assistant message save failed"
        );
        throw error;
    } finally {
        saveSpan.end();
    }
};

const runChatCompletion = async ({
    resourceType,
    resourceId,
    conversationId,
    userId,
    messages,
    query,
    res,
    routeName,
    model,
    highlightContext,
    trace,
}: {
    resourceType: string;
    resourceId: string;
    conversationId: string;
    userId: string;
    messages: ChatMessage[];
    query: string;
    res: Response;
    routeName: string;
    model: OpenAIChatModel;
    highlightContext: HighlightContext | null;
    trace: TraceObservation;
}) => {
    const startedAt = Date.now();
    const responseAbort = createResponseAbortController(res);
    const responseClosed = () =>
        responseAbort.wasClosed() || res.destroyed || res.writableEnded;

    try {
        if (responseClosed()) return;

        const retrievalQuery = buildRetrievalQuery(query, highlightContext);
        const ragResult = await buildRagMessages(
            resourceType,
            resourceId,
            userId,
            messages,
            retrievalQuery,
            highlightContext,
            trace
        );
        if (responseClosed()) return;

        if (
            ragResult.status !== "ready" &&
            ragResult.status !== "no_relevant_context"
        ) {
            trace.setTraceIO({
                output: {
                    status: "failed",
                    finishReason: ragResult.status,
                },
            });
            writeContextFailureAndEnd(res, ragResult.status);
            return;
        }

        if (ragResult.status === "no_relevant_context") {
            const executionMetadata = buildMessageExecutionMetadata({
                modelId: null,
                generationDurationMs: 0,
                totalLatencyMs: Date.now() - startedAt,
                usage: null,
                langfuseTraceId: trace.traceId,
            });
            await saveAssistantMessage(
                conversationId,
                NO_RELEVANT_BOOK_CONTEXT_RESPONSE,
                null,
                "complete",
                "no_relevant_context",
                executionMetadata,
                trace
            );
            trace.setTraceIO({
                output: {
                    status: "complete",
                    finishReason: "no_relevant_context",
                    assistantResponseLength:
                        NO_RELEVANT_BOOK_CONTEXT_RESPONSE.length,
                    sourceCount: 0,
                },
            });
            if (!responseClosed()) {
                res.write(
                    `data: ${JSON.stringify({
                        content: NO_RELEVANT_BOOK_CONTEXT_RESPONSE,
                    })}\n\n`
                );
                res.write(
                    `data: ${JSON.stringify({
                        type: "terminal",
                        status: "complete",
                        finishReason: "no_relevant_context",
                    })}\n\n`
                );
                res.write("data: [DONE]\n\n");
                res.end();
            }
            return;
        }

        if (!ragResult.sources?.length) {
            trace.setTraceIO({
                output: {
                    status: "failed",
                    finishReason: "retrieval_unavailable",
                },
            });
            writeContextFailureAndEnd(res, "retrieval_unavailable");
            return;
        }

        const outcome = await streamAssistantResponse({
            messages: ragResult.messages,
            res,
            trace,
            userId,
            conversationId,
            resourceType,
            resourceId,
            routeName,
            model,
            traceOpenAI: resourceType === "book",
            responseAbort,
        });
        const executionMetadata = buildMessageExecutionMetadata({
            modelId: model,
            generationDurationMs: outcome.generationDurationMs,
            totalLatencyMs: Date.now() - startedAt,
            usage: outcome.usage,
            langfuseTraceId: trace.traceId,
        });

        await saveAssistantMessage(
            conversationId,
            outcome.content,
            ragResult.sources,
            outcome.status,
            outcome.finishReason,
            executionMetadata,
            trace
        );
        trace.setTraceIO({
            output: {
                status: outcome.status,
                finishReason: outcome.finishReason,
                assistantResponseLength: outcome.content.length,
                sourceCount: ragResult.sources?.length ?? 0,
            },
        });

        if (!responseClosed()) {
            if (ragResult.sources?.length) {
                res.write(
                    `data: ${JSON.stringify({ type: "sources", sources: ragResult.sources })}\n\n`
                );
            }
            res.write(
                `data: ${JSON.stringify({
                    type: "terminal",
                    status: outcome.status,
                    finishReason: outcome.finishReason,
                })}\n\n`
            );
            res.write("data: [DONE]\n\n");
            res.end();
        }
    } finally {
        responseAbort.cleanup();
    }
};

const runBookChatTraceIfNeeded = <T>(
    {
        resourceType,
        resourceId,
        conversationId,
        userId,
        routeName,
        messageCount,
        queryLength,
        hasHighlightContext,
    }: {
        resourceType: string;
        resourceId: string;
        conversationId: string;
        userId: string;
        routeName: string;
        messageCount: number;
        queryLength: number;
        hasHighlightContext?: boolean;
    },
    fn: (trace: TraceObservation) => T
) => {
    if (resourceType !== "book") return fn(getNoopTraceObservation());

    return withBookChatTrace(
        {
            userId,
            conversationId,
            resourceType,
            resourceId,
            routeName,
            messageCount,
            queryLength,
            hasHighlightContext,
        },
        fn
    );
};

/**
 * @swagger
 * /api/{resourceType}/{bookId}/conversations:
 *   post:
 *     tags: [Chat]
 *     summary: Create an authorized book conversation and stream its answer
 *     description: The API persists the new user message, loads bounded PostgreSQL history, and fails closed when book context is unavailable. SSE ends with a terminal event described by ChatTerminalEvent.
 *     parameters:
 *       - in: path
 *         name: resourceType
 *         required: true
 *         schema: { type: string, enum: [book] }
 *       - in: path
 *         name: bookId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ChatRequest' }
 *     responses:
 *       200:
 *         description: SSE conversation id, content/source events, and terminal outcome
 *         content:
 *           text/event-stream:
 *             schema: { type: string }
 *       400: { description: Invalid message/model or unsupported resource type }
 *       403: { description: Untrusted Origin or book belongs to another user }
 *       404: { description: Book not found }
 *       429: { description: Chat limit exceeded; Retry-After is returned }
 */
router.post(
    "/:resourceType/:id/conversations",
    authenticate,
    chatRateLimit,
    asyncHandler(async (req: Request, res) => {
        try {
            const request = projectChatRequest(req.body);
            if (!request) {
                res.status(400).send({
                    error: "Message must be a non-empty string of at most 8000 characters",
                });
                return;
            }
            const { message, model } = request;
            const highlightContext = normalizeHighlightContext(
                request.highlightContext
            );
            const chatModel = resolveChatModel(model);
            if (!chatModel) {
                res.status(400).send({
                    error: "Unsupported chat model",
                });
                return;
            }

            await runAuthorizedRequestOperation({
                resourceType: req.params.resourceType,
                resourceId: req.params.id,
                userId: req.user.id,
                res,
                operation: async (resourceType) => {
                    const [conversation] = await db
                        .insert(Conversations)
                        .values({
                            userId: req.user.id,
                            title: message.substring(0, 50) + "...",
                            resourceType,
                            resourceId: req.params.id,
                        })
                        .returning();

                    const messages = await persistUserMessageAndBuildHistory({
                        conversationId: conversation.id,
                        message,
                        repository: chatServerHistoryRepository,
                    });
                    await touchConversation(conversation.id);

                    res.setHeader("Content-Type", "text/event-stream");
                    res.setHeader("Cache-Control", "no-cache");
                    res.setHeader("Connection", "keep-alive");
                    res.write(
                        `data: ${JSON.stringify({ type: "conversation_id", conversationId: conversation.id })}\n\n`
                    );

                    await runBookChatTraceIfNeeded(
                        {
                            resourceType,
                            resourceId: req.params.id,
                            conversationId: conversation.id,
                            userId: req.user.id,
                            routeName: "create_conversation",
                            messageCount: messages.length,
                            queryLength: message.length,
                            hasHighlightContext: Boolean(highlightContext),
                        },
                        (trace) =>
                            runChatCompletion({
                                resourceType,
                                resourceId: req.params.id,
                                conversationId: conversation.id,
                                userId: req.user.id,
                                messages,
                                query: message,
                                res,
                                routeName: "create_conversation",
                                model: chatModel,
                                highlightContext,
                                trace,
                            })
                    );
                },
            });
        } catch (e) {
            console.error("Error in chat stream", e);
            if (!res.headersSent) {
                throw e;
            }
            if (!res.writableEnded) {
                res.write(
                    `data: ${JSON.stringify({ error: "An error occurred" })}\n\n`
                );
                res.end();
            }
        }
    })
);

/**
 * @swagger
 * /api/{resourceType}/{bookId}/conversations:
 *   get:
 *     tags: [Chat]
 *     summary: List conversations for an authorized book
 *     parameters:
 *       - in: path
 *         name: resourceType
 *         required: true
 *         schema: { type: string, enum: [book] }
 *       - in: path
 *         name: bookId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Conversations ordered by latest activity
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [conversations]
 *               properties:
 *                 conversations: { type: array, items: { type: object } }
 *       400: { description: Unsupported resource type }
 *       403: { description: Book belongs to another user }
 *       404: { description: Book not found }
 */
router.get(
    "/:resourceType/:id/conversations",
    authenticate,
    asyncHandler(async (req: Request, res) => {
        try {
            await runAuthorizedRequestOperation({
                resourceType: req.params.resourceType,
                resourceId: req.params.id,
                userId: req.user.id,
                res,
                operation: async (resourceType) => {
                    const conversations = await db
                        .select()
                        .from(Conversations)
                        .where(
                            and(
                                eq(Conversations.userId, req.user.id),
                                eq(Conversations.resourceType, resourceType),
                                eq(Conversations.resourceId, req.params.id)
                            )
                        )
                        .orderBy(desc(Conversations.lastMessageAt));
                    res.status(200).send({ conversations });
                },
            });
        } catch (error) {
            console.error("Error fetching conversations", error);
            if (!res.headersSent) {
                res.status(500).send({
                    error: "An error occurred while fetching conversations",
                });
            }
        }
    })
);

/**
 * @swagger
 * /api/{resourceType}/{bookId}/conversations/{conversationId}/messages:
 *   post:
 *     tags: [Chat]
 *     summary: Persist a user message and stream an authorized answer
 *     description: Client roles and transcripts are ignored. The server uses the newest PostgreSQL history fitting 30 messages and 60,000 characters.
 *     parameters:
 *       - in: path
 *         name: resourceType
 *         required: true
 *         schema: { type: string, enum: [book] }
 *       - in: path
 *         name: bookId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ChatRequest' }
 *     responses:
 *       200:
 *         description: SSE content/source events and terminal outcome
 *         content:
 *           text/event-stream:
 *             schema: { type: string }
 *       400: { description: Invalid message/model or unsupported resource type }
 *       403: { description: Untrusted Origin or book belongs to another user }
 *       404: { description: Book or scoped conversation not found }
 *       429: { description: Chat limit exceeded; Retry-After is returned }
 */
router.post(
    "/:resourceType/:rid/conversations/:cid/messages",
    authenticate,
    chatRateLimit,
    asyncHandler(async (req, res) => {
        try {
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

            const request = projectChatRequest(req.body);
            if (!request) {
                res.status(400).send({
                    error: "Message must be a non-empty string of at most 8000 characters",
                });
                return;
            }
            const { message, model } = request;
            const highlightContext = normalizeHighlightContext(
                request.highlightContext
            );
            const chatModel = resolveChatModel(model);
            if (!chatModel) {
                res.status(400).send({
                    error: "Unsupported chat model",
                });
                return;
            }

            await runAuthorizedScopedRequestOperation({
                resourceType,
                resourceId,
                conversationId,
                userId: req.user.id,
                res,
                operation: async (_conversation, authorizedResourceType) => {
                    const messages = await persistUserMessageAndBuildHistory({
                        conversationId,
                        message,
                        repository: chatServerHistoryRepository,
                    });
                    await touchConversation(conversationId);

                    res.setHeader("Content-Type", "text/event-stream");
                    res.setHeader("Cache-Control", "no-cache");
                    res.setHeader("Connection", "keep-alive");

                    await runBookChatTraceIfNeeded(
                        {
                            resourceType: authorizedResourceType,
                            resourceId,
                            conversationId,
                            userId: req.user.id,
                            routeName: "append_message",
                            messageCount: messages.length,
                            queryLength: message.length,
                            hasHighlightContext: Boolean(highlightContext),
                        },
                        (trace) =>
                            runChatCompletion({
                                resourceType: authorizedResourceType,
                                resourceId,
                                conversationId,
                                userId: req.user.id,
                                messages,
                                query: message,
                                res,
                                routeName: "append_message",
                                model: chatModel,
                                highlightContext,
                                trace,
                            })
                    );
                },
            });
        } catch (error) {
            console.error("Error in chat messages", error);
            if (!res.headersSent) {
                throw error;
            }
            if (!res.writableEnded) {
                res.write(
                    `data: ${JSON.stringify({ error: "An error occurred" })}\n\n`
                );
                res.end();
            }
        }
    })
);

/**
 * @swagger
 * /api/{resourceType}/{bookId}/conversations/{conversationId}:
 *   get:
 *     tags: [Chat]
 *     summary: Get public messages for an authorized conversation
 *     parameters:
 *       - in: path
 *         name: resourceType
 *         required: true
 *         schema: { type: string, enum: [book] }
 *       - in: path
 *         name: bookId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Chronological messages without private execution metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [messages]
 *               properties:
 *                 messages:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/PublicMessage' }
 *       400: { description: Unsupported resource type }
 *       403: { description: Book belongs to another user }
 *       404: { description: Book or scoped conversation not found }
 */
router.get(
    "/:resourceType/:id/conversations/:conversationId",
    authenticate,
    asyncHandler(async (req: Request, res) => {
        try {
            await runAuthorizedScopedRequestOperation({
                resourceType: req.params.resourceType,
                resourceId: req.params.id,
                conversationId: req.params.conversationId,
                userId: req.user.id,
                res,
                operation: async () => {
                    const conversationId = req.params.conversationId;
                    const messages = await db
                        .select(PUBLIC_MESSAGE_SELECTION)
                        .from(Messages)
                        .where(eq(Messages.conversationId, conversationId))
                        .orderBy(Messages.createdAt);

                    res.send({ messages });
                },
            });
        } catch (error) {
            console.error("Error fetching conversation details", error);
            if (!res.headersSent) {
                res.status(500).send({
                    error: "An error occurred while retrieving conversation details",
                });
            }
        }
    })
);

export default router;
