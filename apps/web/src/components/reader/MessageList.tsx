import { ScrollArea } from "@radix-ui/react-scroll-area";
import { BookOpenText, ChevronDown, LoaderCircle } from "lucide-react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { normalizeAllowedWebUrl, type ContextSource } from "@/lib/chatSources";

export type Message = {
    id?: string | null;
    role: string;
    content: string;
    contextSources?: ContextSource[] | null;
    activityStatus?: "searching_web" | null;
    completionStatus?: "complete" | "truncated" | "cancelled" | "failed" | null;
    finishReason?: string | null;
};

const completionNotices: Partial<
    Record<NonNullable<Message["completionStatus"]>, string>
> = {
    truncated:
        "This response reached the model output limit and may be incomplete.",
    cancelled: "This response was cancelled before completion.",
    failed: "This response failed before completion.",
};

const formatScore = (score: number) =>
    Number.isFinite(score) ? score.toFixed(4) : "n/a";

const MessageSources = ({ sources }: { sources: ContextSource[] }) => {
    const allowedUrls = new Set(
        sources
            .filter((source) => source.sourceType === "web")
            .map((source) => source.url)
    );
    return (
        <details className="group max-w-[85%] rounded-[var(--radius-input)] border border-[var(--color-chat-rule)] bg-[var(--color-chat-raised)] text-[var(--color-chat-muted)]">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-[var(--color-chat-text)] marker:hidden [&::-webkit-details-marker]:hidden">
                <BookOpenText className="h-4 w-4 text-[var(--color-accent-2)]" />
                <span>Sources</span>
                <span className="rounded-[var(--radius-pill)] bg-[var(--color-chat)] px-2 py-0.5 text-[11px] leading-4 text-[var(--color-chat-muted)]">
                    {sources.length}
                </span>
                <ChevronDown className="ml-auto h-4 w-4 text-[var(--color-chat-muted)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="max-h-80 space-y-3 overflow-y-auto border-t border-[var(--color-chat-rule)] px-3 py-3">
                {sources.map((source, index) => {
                    if (source.sourceType === "web") {
                        const url = normalizeAllowedWebUrl(
                            source.url,
                            allowedUrls
                        );
                        return (
                            <div
                                key={`${source.url}-${index}`}
                                className="border-b border-[var(--color-chat-rule)] pb-3 last:border-b-0 last:pb-0"
                            >
                                <p className="break-words text-xs leading-relaxed">
                                    {source.title}
                                </p>
                                {url && (
                                    <a
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="break-all text-xs underline"
                                    >
                                        {new URL(url).hostname}
                                    </a>
                                )}
                            </div>
                        );
                    }
                    return (
                        <div
                            key={`${source.id}-${index}`}
                            className="border-b border-[var(--color-chat-rule)] pb-3 last:border-b-0 last:pb-0"
                        >
                            <div className="font-label mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold uppercase tracking-normal text-[var(--color-chat-muted)]">
                                <span>Chunk {source.chunkIndex}</span>
                                <span>Score {formatScore(source.score)}</span>
                                <span>Rank {source.bestRank}</span>
                            </div>
                            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--color-chat-muted)]">
                                {source.excerpt}
                            </p>
                        </div>
                    );
                })}
            </div>
        </details>
    );
};

const AssistantMessageContent = ({
    content,
    sources,
}: {
    content: string;
    sources: ContextSource[];
}) => {
    const allowedUrls = new Set(
        sources
            .filter((source) => source.sourceType === "web")
            .map((source) => source.url)
    );
    return (
        <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
                a: ({ children, href }) => {
                    const safeUrl = normalizeAllowedWebUrl(href, allowedUrls);
                    return safeUrl ? (
                        <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {children}
                        </a>
                    ) : (
                        <>{children}</>
                    );
                },
                img: ({ alt }) => <>{alt ?? ""}</>,
            }}
        >
            {content}
        </ReactMarkdown>
    );
};

const MessageList = memo(({ messages }: { messages: Message[] }) => {
    return (
        <ScrollArea className="h-full space-y-3 overflow-y-scroll p-6 md:p-8">
            {messages.filter(Boolean).map((message: Message, index: number) => {
                const isAssistant = message.role === "assistant";
                const sources = message.contextSources ?? [];
                const completionNotice = message.completionStatus
                    ? completionNotices[message.completionStatus]
                    : undefined;

                return (
                    <div
                        key={index}
                        className={`mb-4 flex flex-col gap-2 ${
                            isAssistant ? "items-start" : "items-end"
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            {isAssistant && (
                                <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--color-chat-rule)] bg-[var(--color-accent)] text-[var(--color-accent-ink)]">
                                    <BookOpenText className="h-4 w-4" />
                                </div>
                            )}
                            <span className="font-label text-xs font-medium leading-4 text-[var(--color-chat-muted)]">
                                {isAssistant ? "Mentarie" : "You"}
                            </span>
                            {!isAssistant && (
                                <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-accent-2)] text-xs font-bold text-[var(--color-ink)]">
                                    U
                                </div>
                            )}
                        </div>
                        <div
                            className={`max-w-[85%] rounded-[var(--radius-card)] p-4 ${
                                isAssistant
                                    ? "rounded-tl-sm border border-[var(--color-chat-rule)] bg-[var(--color-chat-raised)] text-[var(--color-chat-text)]"
                                    : "rounded-tr-sm bg-[var(--color-accent-2)] text-[var(--color-ink)]"
                            }`}
                        >
                            {isAssistant ? (
                                message.activityStatus === "searching_web" &&
                                !message.content ? (
                                    <div
                                        className="flex items-center gap-2 font-sans text-sm font-semibold leading-relaxed text-[var(--color-chat-muted)]"
                                        role="status"
                                        aria-live="polite"
                                    >
                                        <LoaderCircle className="h-4 w-4 animate-spin" />
                                        <span>Searching the web…</span>
                                    </div>
                                ) : (
                                    <div className="chat-markdown font-sans text-sm font-semibold leading-relaxed">
                                        <AssistantMessageContent
                                            content={message.content}
                                            sources={sources}
                                        />
                                    </div>
                                )
                            ) : (
                                <p className="whitespace-pre-wrap font-sans text-sm font-semibold leading-relaxed">
                                    {message.content}
                                </p>
                            )}
                        </div>
                        {isAssistant && sources.length > 0 && (
                            <MessageSources sources={sources} />
                        )}
                        {isAssistant && completionNotice && (
                            <p
                                className="max-w-[85%] text-xs leading-relaxed text-[var(--color-accent)]"
                                role="status"
                            >
                                {completionNotice}
                            </p>
                        )}
                    </div>
                );
            })}
        </ScrollArea>
    );
});
MessageList.displayName = "MessageList";
export default MessageList;
