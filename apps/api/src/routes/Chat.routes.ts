import { and, asc, desc, eq } from "drizzle-orm";
import { createLogger } from "@reader/providers";
import { db } from "../db";
import {
    Books,
    Conversations,
    Messages,
    type BookMessageContextSource,
    type MessageContextSource,
    type MessageExecutionMetadata,
} from "../db/schema";
import { authenticate } from "../middleware/auth";
import { chatRateLimit } from "../middleware/rateLimit";
import { asyncHandler } from "../middleware/asyncHandler";
import {
    OPENAI_CHAT_MAX_TOKENS,
    OPENAI_CHAT_TEMPERATURE,
    type ChatMessage,
} from "../services/OpenAIServices";
import {
    ChatCompletionService,
    type ChatProviderSelection,
} from "../services/ChatCompletionService";
import {
    BOOK_GROUNDED_SYSTEM_PROMPT,
    buildBookContextMessage,
    buildRetrievalQuery,
    normalizeHighlightContext,
    type HighlightContext,
    type BookPromptMetadata,
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
    classifyStoredBookContext,
    type BookContextStatus,
} from "../services/BookContextState";
import {
    buildMessageExecutionMetadata,
    normalizeMessageContextSources,
    PUBLIC_MESSAGE_SELECTION,
} from "../services/ChatExecutionMetadata";
import {
    BOOK_WEB_SEARCH_MODEL,
    bookGroundedSearchService,
} from "../services/BookGroundedSearchService";

const router = Router();
const chatCompletionService = new ChatCompletionService();
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
        request_id?: unknown;
        requestID?: unknown;
        status?: unknown;
        type?: unknown;
        name?: unknown;
    };

    return [
        details.name,
        details.type,
        details.status,
        details.code,
        details.errno,
        details.request_id,
        details.requestID,
        details.message,
    ]
        .filter(Boolean)
        .join(" ");
};

const isPrematureCloseError = (error: unknown) =>
    getErrorDetail(error).includes("ERR_STREAM_PREMATURE_CLOSE") ||
    getErrorDetail(error).includes("Premature close");

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
): BookMessageContextSource[] =>
    results.map((result) => ({
        sourceType: "book",
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
    book: BookPromptMetadata | null;
    bookContext: string | null;
    sources: BookMessageContextSource[] | null;
}> => {
    log.debug("Building RAG messages", {
        resourceType,
        resourceId,
        userId,
        queryLength: query.length,
    });
    const empty = (
        status: BookContextStatus,
        book: BookPromptMetadata | null = null
    ) => ({ messages, status, book, bookContext: null, sources: null });
    if (resourceType !== "book") return empty("retrieval_unavailable");

    const loadBookSpan = trace.startObservation("load_book", {
        input: { resourceType, resourceId },
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
            },
        });
    } catch (error) {
        recordObservationError(loadBookSpan, error, "Book lookup failed");
        return empty("retrieval_unavailable");
    } finally {
        loadBookSpan.end();
    }

    const contextState = classifyStoredBookContext(book);
    if (contextState !== "ready") return empty(contextState);
    if (!book?.collectionName) return empty("retrieval_unavailable");
    const modelMetadata: BookPromptMetadata = {
        title: book.embeddedTitle ?? null,
        creator: book.creator ?? null,
        identifier: book.identifier ?? null,
        fileType: book.fileType,
    };
    const collectionName = book.collectionName;
    try {
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
            retrievalSpan.update({
                output: {
                    resultCount: searchResults.length,
                    selectedChunks: summarizeRetrievedChunks(searchResults),
                },
            });
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
        if (!relevantResults.length)
            return empty("no_relevant_context", modelMetadata);
        const bookContext = relevantResults
            .map((result) => result.content)
            .join("\n\n---\n\n");
        return {
            status: "ready",
            book: modelMetadata,
            bookContext,
            sources: buildContextSources(relevantResults),
            messages: [
                buildBookContextMessage(
                    bookContext,
                    modelMetadata,
                    highlightContext
                ),
                ...messages,
            ],
        };
    } catch (error) {
        log.error("Error retrieving book context", {
            resourceId,
            collectionName,
            error: getErrorDetail(error),
        });
        return empty("retrieval_unavailable");
    }
};

type ChatFailureStatus =
    | Exclude<BookContextStatus, "ready" | "no_relevant_context">
    | "grounding_unavailable"
    | "web_search_unavailable";

const writeChatFailureAndEnd = (res: Response, status: ChatFailureStatus) => {
    const messages: Record<ChatFailureStatus, string> = {
        ...BOOK_CONTEXT_FAILURE_MESSAGES,
        grounding_unavailable:
            "Book answer grounding is temporarily unavailable. Please try again later.",
        web_search_unavailable:
            "External book search is temporarily unavailable. Please try again later.",
    };
    res.write(
        `data: ${JSON.stringify({ error: messages[status], status })}\n\n`
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
    selection,
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
    selection: ChatProviderSelection;
    traceOpenAI: boolean;
    responseAbort: ReturnType<typeof createResponseAbortController>;
}) => {
    const generationStartedAt = Date.now();
    const openAiSpan = trace.startObservation("openai_chat_stream", {
        input: {
            model: selection.model,
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
        const textStream = chatCompletionService.generateStreamResponse(
            userId,
            selection,
            messages,
            BOOK_GROUNDED_SYSTEM_PROMPT,
            {
                signal: responseAbort.controller.signal,
                ...(traceOpenAI && selection.provider === "openai"
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
                                  model: selection.model,
                              },
                              parentSpanContext: openAiSpan.getSpanContext(),
                          },
                      }
                    : {}),
            }
        );

        for await (const event of textStream) {
            if (responseAbort.wasClosed() || res.destroyed || res.writableEnded)
                break;
            if (event.finishReason) {
                finishReason = event.finishReason;
            }
            if (event.usage) {
                usage = event.usage;
            }
            accumulatedResponse += event.content;
            if (event.content) {
                res.write(
                    `data: ${JSON.stringify({ content: event.content })}\n\n`
                );
            }
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
            log.error("Chat response stream failed", {
                conversationId,
                userId,
                resourceType,
                resourceId,
                routeName,
                provider: selection.provider,
                model: selection.model,
                finishReason,
                outputLength: accumulatedResponse.length,
                error: getErrorDetail(streamError),
            });
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
    selection,
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
    selection: ChatProviderSelection;
    highlightContext: HighlightContext | null;
    trace: TraceObservation;
}) => {
    const startedAt = Date.now();
    const responseAbort = createResponseAbortController(res);
    const responseClosed = () =>
        responseAbort.wasClosed() || res.destroyed || res.writableEnded;
    const emitComplete = async (
        content: string,
        finishReason: string,
        contextSources: MessageContextSource[] | null,
        modelId: string | null,
        generationDurationMs: number,
        usage: unknown
    ) => {
        await saveAssistantMessage(
            conversationId,
            content,
            contextSources,
            "complete",
            finishReason,
            buildMessageExecutionMetadata({
                modelId,
                generationDurationMs,
                totalLatencyMs: Date.now() - startedAt,
                usage,
                langfuseTraceId: trace.traceId,
            }),
            trace
        );
        if (responseClosed()) return;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
        if (contextSources?.length)
            res.write(
                `data: ${JSON.stringify({ type: "sources", sources: contextSources })}\n\n`
            );
        res.write(
            `data: ${JSON.stringify({
                type: "terminal",
                status: "complete",
                finishReason,
            })}\n\n`
        );
        res.write("data: [DONE]\n\n");
        res.end();
    };

    try {
        if (responseClosed()) return;
        const ragResult = await buildRagMessages(
            resourceType,
            resourceId,
            userId,
            messages,
            buildRetrievalQuery(query, highlightContext),
            highlightContext,
            trace
        );
        if (responseClosed()) return;
        if (
            ragResult.status !== "ready" &&
            ragResult.status !== "no_relevant_context"
        ) {
            writeChatFailureAndEnd(res, ragResult.status);
            return;
        }
        if (!ragResult.book) {
            writeChatFailureAndEnd(res, "retrieval_unavailable");
            return;
        }

        const assessment = await bookGroundedSearchService.assessQuestion({
            question: query,
            history: messages,
            book: ragResult.book,
            bookContext: ragResult.bookContext,
            highlightContext,
            signal: responseAbort.controller.signal,
        });
        if (responseClosed()) return;
        if (assessment.kind === "grounding_unavailable") {
            writeChatFailureAndEnd(res, "grounding_unavailable");
            return;
        }
        if (assessment.decision === "reject_unrelated") {
            await emitComplete(
                "I can only answer questions about this book.",
                "not_about_book",
                null,
                null,
                0,
                null
            );
            return;
        }

        const useWeb =
            assessment.decision === "search_web" ||
            ragResult.status === "no_relevant_context" ||
            !ragResult.sources?.length;
        if (useWeb) {
            const publicQuestion = assessment.standalonePublicQuestion;
            if (!publicQuestion) {
                await emitComplete(
                    "I couldn't find reliable public sources about this book. Try naming the person, character, place, or adaptation directly.",
                    "no_relevant_web_context",
                    null,
                    null,
                    0,
                    null
                );
                return;
            }
            res.write(
                `data: ${JSON.stringify({
                    type: "status",
                    status: "searching_web",
                })}\n\n`
            );
            const searchStartedAt = Date.now();
            const result = await bookGroundedSearchService.searchBookWeb({
                publicQuestion,
                signal: responseAbort.controller.signal,
            });
            if (responseClosed()) return;
            if (result.kind === "web_search_unavailable") {
                writeChatFailureAndEnd(res, "web_search_unavailable");
                return;
            }
            if (result.kind === "no_cited_answer") {
                await emitComplete(
                    "I couldn't find reliable public sources about this book. Try naming the person, character, place, or adaptation directly.",
                    "no_relevant_web_context",
                    null,
                    BOOK_WEB_SEARCH_MODEL,
                    Date.now() - searchStartedAt,
                    result.usage
                );
                return;
            }
            await emitComplete(
                result.content,
                "web_search",
                result.sources,
                BOOK_WEB_SEARCH_MODEL,
                Date.now() - searchStartedAt,
                result.usage
            );
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
            selection,
            traceOpenAI: resourceType === "book",
            responseAbort,
        });
        await saveAssistantMessage(
            conversationId,
            outcome.content,
            ragResult.sources,
            outcome.status,
            outcome.finishReason,
            buildMessageExecutionMetadata({
                modelId: selection.model,
                generationDurationMs: outcome.generationDurationMs,
                totalLatencyMs: Date.now() - startedAt,
                usage: outcome.usage,
                langfuseTraceId: trace.traceId,
            }),
            trace
        );
        if (!responseClosed()) {
            res.write(
                `data: ${JSON.stringify({ type: "sources", sources: ragResult.sources })}\n\n`
            );
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
 *     description: The API persists the new user message, loads bounded PostgreSQL history, and fails closed when book context is unavailable. Normal SSE completion emits ChatTerminalEvent and [DONE]; a fatal error after headers were sent emits ChatFatalErrorEvent and closes the stream.
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
 *         description: SSE conversation id, content/source events, and terminal outcome, or a fatal post-header error event
 *         content:
 *           text/event-stream:
 *             schema: { $ref: '#/components/schemas/ChatStreamEvent' }
 *       400: { description: Invalid message/model or unsupported resource type }
 *       403: { description: Untrusted Origin or book belongs to another user }
 *       404: { description: Book not found }
 *       429: { description: Chat limit exceeded; Retry-After is returned }
 *       500: { $ref: '#/components/responses/InternalError' }
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

            await runAuthorizedRequestOperation({
                resourceType: req.params.resourceType,
                resourceId: req.params.id,
                userId: req.user.id,
                res,
                operation: async (resourceType) => {
                    const selection =
                        await chatCompletionService.resolveSelection(
                            req.user.id,
                            model
                        );
                    if (!selection) {
                        res.status(400).send({
                            error: "Unsupported chat model for the selected provider",
                        });
                        return;
                    }
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
                                selection,
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
 *       500: { $ref: '#/components/responses/InternalError' }
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
 *     description: Client roles and transcripts are ignored. The server uses the newest PostgreSQL history fitting 30 messages and 60,000 characters. Normal SSE completion emits ChatTerminalEvent and [DONE]; a fatal error after headers were sent emits ChatFatalErrorEvent and closes the stream.
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
 *         description: SSE content/source events and terminal outcome, or a fatal post-header error event
 *         content:
 *           text/event-stream:
 *             schema: { $ref: '#/components/schemas/ChatStreamEvent' }
 *       400: { description: Invalid message/model or unsupported resource type }
 *       403: { description: Untrusted Origin or book belongs to another user }
 *       404: { description: Book or scoped conversation not found }
 *       429: { description: Chat limit exceeded; Retry-After is returned }
 *       500: { $ref: '#/components/responses/InternalError' }
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

            await runAuthorizedScopedRequestOperation({
                resourceType,
                resourceId,
                conversationId,
                userId: req.user.id,
                res,
                operation: async (_conversation, authorizedResourceType) => {
                    const selection =
                        await chatCompletionService.resolveSelection(
                            req.user.id,
                            model
                        );
                    if (!selection) {
                        res.status(400).send({
                            error: "Unsupported chat model for the selected provider",
                        });
                        return;
                    }
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
                                selection,
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
 *       500: { $ref: '#/components/responses/InternalError' }
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

                    res.send({
                        messages: messages.map((message) => ({
                            ...message,
                            contextSources: normalizeMessageContextSources(
                                message.contextSources
                            ),
                        })),
                    });
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
