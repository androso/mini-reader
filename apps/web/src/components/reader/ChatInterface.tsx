"use client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    ArrowLeft,
    SendHorizontal,
    History,
    ChevronDown,
    Quote,
    X,
    PanelLeftOpen,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import MessageList, { Message } from "./MessageList";
import ChatHistory from "./ChatHistory";
import useConversations from "@/hooks/chat/useConversations";
import { useChat } from "@/hooks/chat/useChat";
import { useBookProcessingStatus } from "@/hooks/useBookProcessingStatus";
import { canRetryBookProcessing } from "@/lib/bookProcessingRetry";
import type { HighlightContext } from "@/types/highlightContext";

const CHAT_MODELS = [
    { value: "gpt-4o-mini", label: "GPT-4o mini" },
    { value: "gpt-5.5-2026-04-23", label: "GPT-5.5" },
    { value: "gpt-5.4-mini-2026-03-17", label: "GPT-5.4 mini" },
];

interface ChatInterfaceProps {
    isMobile?: boolean;
    bookId: string;
    onBack?: () => void;
    highlightContext?: HighlightContext | null;
    onClearHighlightContext?: () => void;
}

const ChatLayout = ({
    isMobile,
    isExpanded,
    children,
}: {
    isMobile: boolean;
    isExpanded: boolean;
    children: React.ReactNode;
}) => {
    const layoutClasses = useMemo(() => {
        const baseClasses = `flex flex-col ${!isMobile && "h-full flex-1"} overflow-hidden`;
        const mobileClasses = isMobile
            ? `absolute bottom-4 w-[calc(100%-2rem)] left-1/2 -translate-x-1/2 rounded-[var(--radius-panel)] ${
                  isExpanded
                      ? "h-[80dvh] border border-[var(--color-chat-rule)] bg-[var(--color-chat)] text-[var(--color-chat-text)]"
                      : "border border-transparent bg-transparent"
              }`
            : "";
        return `${baseClasses} ${mobileClasses} ${!isMobile ? "bg-[var(--color-chat)]" : ""}`;
    }, [isMobile, isExpanded]);

    return <div className={layoutClasses}>{children}</div>;
};

export function ChatInterface({
    isMobile = false,
    bookId,
    onBack,
    highlightContext = null,
    onClearHighlightContext,
}: ChatInterfaceProps) {
    const conversationsQuery = useConversations(bookId);
    const { data: conversationsData, refetch: refetchConversations } =
        conversationsQuery;
    const {
        data: processingStatus,
        retry: retryProcessing,
        isRetrying,
        retryError,
    } = useBookProcessingStatus(bookId);
    const [selectedModel, setSelectedModel] = useState(CHAT_MODELS[0].value);
    const [isComposerFocused, setIsComposerFocused] = useState(false);
    const [isDesktopHistoryVisible, setIsDesktopHistoryVisible] =
        useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const isDocumentReady = processingStatus?.ready ?? false;
    const processingError =
        processingStatus?.status === "queue_failed"
            ? "Document processing could not be queued. The original file was preserved and can be retried."
            : processingStatus?.status === "failed"
              ? processingStatus.error ||
                "Document text processing failed. This PDF may be scanned or image-only, and OCR is not enabled yet."
              : null;
    const canRetryProcessing = canRetryBookProcessing(processingStatus);
    const {
        chatState,
        handleSelectConversation,
        handleSubmit,
        input,
        setChatState,
        setInput,
        startNewConversation,
    } = useChat(bookId);
    const conversations = conversationsData?.conversations ?? [];
    const isMobileChatOpen =
        isMobile && chatState.isChatOpen && chatState.isExpanded;

    const handleMobileChatClose = () => {
        inputRef.current?.blur();
        setIsComposerFocused(false);
        setChatState((prev) => ({
            ...prev,
            isChatOpen: false,
            isExpanded: false,
            isHistoryOpen: false,
        }));
    };

    const handleComposerFocusChange = (focused: boolean) => {
        setIsComposerFocused(focused);
    };

    useEffect(() => {
        if (isMobile || !highlightContext || !isDocumentReady) return;

        inputRef.current?.focus();
    }, [highlightContext, isDocumentReady, isMobile]);

    return (
        <div className={`relative flex ${!isMobile && "h-full w-full"}`}>
            {!isMobile && isDesktopHistoryVisible && (
                <div className="w-64 shrink-0 overflow-x-hidden">
                    <ChatHistory
                        conversations={conversations}
                        currentConversationId={
                            chatState.currentConversation?.id
                        }
                        isLoading={conversationsQuery.isLoading}
                        isError={conversationsQuery.isError}
                        onNewConversation={startNewConversation}
                        onHideHistory={() => setIsDesktopHistoryVisible(false)}
                        onSelectConversation={handleSelectConversation}
                    />
                </div>
            )}
            <ChatLayout isMobile={isMobile} isExpanded={chatState.isExpanded}>
                {!isMobile && onBack && (
                    <div className="flex shrink-0 items-center gap-1 px-6 pt-6 md:px-8 md:pt-8">
                        {!isDesktopHistoryVisible && (
                            <button
                                type="button"
                                onClick={() => {
                                    refetchConversations();
                                    setIsDesktopHistoryVisible(true);
                                }}
                                className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-pill)] text-[var(--color-chat-muted)] transition-[background-color,color] duration-short hover:bg-[var(--color-chat-raised)] hover:text-[var(--color-chat-text)]"
                                aria-label="Show previous chats"
                                title="Show previous chats"
                            >
                                <PanelLeftOpen className="h-[18px] w-[18px]" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onBack}
                            className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-pill)] text-[var(--color-chat-muted)] transition-[background-color,color] duration-short hover:bg-[var(--color-chat-raised)] hover:text-[var(--color-chat-text)]"
                            aria-label="Back"
                            title="Back"
                        >
                            <ArrowLeft className="h-[18px] w-[18px]" />
                        </button>
                    </div>
                )}
                {isMobileChatOpen && (
                    <MobileChatToolbar onClose={handleMobileChatClose} />
                )}
                {isMobile &&
                    chatState.isChatOpen &&
                    chatState.isHistoryOpen && (
                        <div className="overflow-scroll h-full">
                            <ChatHistory
                                conversations={conversations}
                                currentConversationId={
                                    chatState.currentConversation?.id
                                }
                                isLoading={conversationsQuery.isLoading}
                                isError={conversationsQuery.isError}
                                onNewConversation={startNewConversation}
                                onSelectConversation={handleSelectConversation}
                            />
                        </div>
                    )}
                {chatState.isChatOpen &&
                    !chatState.isHistoryOpen &&
                    (!isMobile || chatState.isExpanded) && (
                        <ChatMessages messages={chatState.messages} />
                    )}
                <ChatInput
                    input={input}
                    setInput={setInput}
                    handleSubmit={(event) =>
                        handleSubmit(
                            event,
                            selectedModel,
                            highlightContext,
                            onClearHighlightContext
                        )
                    }
                    isDocumentReady={isDocumentReady}
                    isCheckingStatus={!processingStatus}
                    processingError={processingError}
                    canRetryProcessing={canRetryProcessing}
                    isRetrying={isRetrying}
                    retryError={retryError ? retryError.message : null}
                    onRetryProcessing={() => void retryProcessing()}
                    highlightContext={highlightContext}
                    onClearHighlightContext={onClearHighlightContext}
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    inputRef={inputRef}
                    showModelSelector={!isMobile || isComposerFocused}
                    onComposerFocusChange={handleComposerFocusChange}
                    onHistoryClick={() => {
                        if (isMobile) {
                            refetchConversations();
                            setChatState((prev) => ({
                                ...prev,
                                isHistoryOpen: !prev.isHistoryOpen,
                                isChatOpen: true,
                                isExpanded: true,
                            }));
                            return;
                        }

                        setIsDesktopHistoryVisible((isVisible) => {
                            if (!isVisible) {
                                refetchConversations();
                            }

                            return !isVisible;
                        });
                    }}
                    showHistoryButton={isMobile}
                    historyButtonLabel={
                        isMobile
                            ? "Toggle previous chats"
                            : isDesktopHistoryVisible
                              ? "Hide previous chats"
                              : "Show previous chats"
                    }
                    isHistoryButtonActive={
                        isMobile
                            ? chatState.isHistoryOpen
                            : isDesktopHistoryVisible
                    }
                />
            </ChatLayout>
        </div>
    );
}

const ChatMessages = ({ messages }: { messages: Message[] }) => (
    <div className="min-h-0 flex-1">
        <MessageList messages={messages} />
    </div>
);

const MobileChatToolbar = ({ onClose }: { onClose: () => void }) => {
    return (
        <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-[var(--color-chat-rule)] px-3 py-2">
            <span className="font-label text-xs font-semibold text-[var(--color-chat-muted)]">
                Chat
            </span>
            <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={onClose}
                aria-label="Close chat"
                title="Close chat"
                className="ml-auto h-11 w-11 rounded-[var(--radius-pill)] text-[var(--color-chat-muted)] transition-[background-color,color,transform] duration-short hover:bg-[var(--color-chat-raised)] hover:text-[var(--color-chat-text)] active:translate-y-px focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--color-accent-2)] disabled:cursor-not-allowed disabled:opacity-60"
            >
                <X className="h-5 w-5" />
            </Button>
        </div>
    );
};

const ChatInput = ({
    input,
    setInput,
    handleSubmit,
    isDocumentReady,
    isCheckingStatus,
    processingError,
    canRetryProcessing,
    isRetrying,
    retryError,
    onRetryProcessing,
    highlightContext,
    onClearHighlightContext,
    selectedModel,
    setSelectedModel,
    inputRef,
    showModelSelector,
    onComposerFocusChange,
    onHistoryClick,
    showHistoryButton,
    historyButtonLabel,
    isHistoryButtonActive,
}: {
    input: string;
    setInput: (value: string) => void;
    handleSubmit: (e: React.FormEvent) => void;
    isDocumentReady: boolean;
    isCheckingStatus: boolean;
    processingError: string | null;
    canRetryProcessing: boolean;
    isRetrying: boolean;
    retryError: string | null;
    onRetryProcessing: () => void;
    highlightContext: HighlightContext | null;
    onClearHighlightContext?: () => void;
    selectedModel: string;
    setSelectedModel: (value: string) => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
    showModelSelector: boolean;
    onComposerFocusChange: (focused: boolean) => void;
    onHistoryClick: () => void;
    showHistoryButton: boolean;
    historyButtonLabel: string;
    isHistoryButtonActive: boolean;
}) => (
    <form
        onSubmit={handleSubmit}
        onFocus={() => onComposerFocusChange(true)}
        onBlur={(event) => {
            const nextFocused = event.relatedTarget as Node | null;
            if (!event.currentTarget.contains(nextFocused)) {
                onComposerFocusChange(false);
            }
        }}
        className="mt-auto shrink-0 p-6 md:p-8"
    >
        {!isDocumentReady && (
            <div
                className={`mb-3 rounded-[var(--radius-input)] border px-3 py-2 text-sm ${
                    processingError
                        ? "border-[var(--color-accent-3)] bg-[var(--color-accent-3-soft)] text-[var(--color-ink)]"
                        : "border-[var(--color-accent-deep)] bg-[var(--color-paper-2)] text-[var(--color-ink)]"
                }`}
            >
                {processingError ||
                    (isCheckingStatus
                        ? "Checking document processing status..."
                        : "Document context is still processing. You can ask questions once it is ready.")}
                {canRetryProcessing && (
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onRetryProcessing}
                            disabled={isRetrying}
                            className="min-h-11 rounded-[var(--radius-pill)] border border-current px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isRetrying ? "Retrying..." : "Retry processing"}
                        </button>
                        {retryError && <span>{retryError}</span>}
                    </div>
                )}
            </div>
        )}
        {showModelSelector && (
            <div className="mb-2 flex justify-end">
                <div className="relative">
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        aria-label="Chat model"
                        className="h-11 appearance-none rounded-[var(--radius-input)] border border-[var(--color-chat-rule)] bg-[var(--color-chat-raised)] pl-3 pr-8 text-sm font-semibold text-[var(--color-chat-text)] outline-none transition-[background-color,border-color] duration-short hover:bg-[var(--color-chat)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--color-accent-2)]"
                    >
                        {CHAT_MODELS.map((model) => (
                            <option key={model.value} value={model.value}>
                                {model.label}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-chat-muted)]" />
                </div>
            </div>
        )}
        {highlightContext && (
            <div className="mb-2 rounded-[var(--radius-input)] border border-[var(--color-chat-rule)] bg-[var(--color-chat-raised)] px-3 py-2 text-[var(--color-chat-text)]">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[var(--color-chat-muted)]">
                    <Quote className="h-3.5 w-3.5 text-[var(--color-accent-2)]" />
                    <span>Selected text</span>
                    <button
                        type="button"
                        onClick={onClearHighlightContext}
                        className="ml-auto grid h-8 w-8 place-items-center rounded-[var(--radius-pill)] text-[var(--color-chat-muted)] transition-[background-color,color] duration-short hover:bg-[var(--color-chat)] hover:text-[var(--color-chat-text)]"
                        aria-label="Remove selected text"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
                <p className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-xs font-medium leading-relaxed text-[var(--color-chat-muted)]">
                    {highlightContext.text}
                </p>
            </div>
        )}
        <div className="flex items-center gap-2 rounded-[var(--radius-pill)] bg-[var(--color-paper-raised)] py-2 pl-2 pr-3">
            {showHistoryButton && (
                <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={onHistoryClick}
                    aria-label={historyButtonLabel}
                    title={historyButtonLabel}
                    className={`h-11 w-11 rounded-[var(--radius-pill)] text-[var(--color-ink-2)] hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)] ${
                        isHistoryButtonActive
                            ? "bg-[var(--color-paper-2)] text-[var(--color-ink)]"
                            : ""
                    }`}
                >
                    <History className="h-5 w-5" />
                </Button>
            )}
            <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                    isDocumentReady
                        ? "Ask about this document..."
                        : processingError
                          ? "Document text processing failed"
                          : "Document context is processing..."
                }
                className="h-11 flex-1 border-0 bg-transparent px-2 font-sans text-sm font-semibold text-[var(--color-ink)] shadow-none outline-none placeholder:text-[var(--color-ink-soft)] focus-visible:outline-none"
                disabled={!isDocumentReady}
            />
            <Button
                type="submit"
                size="icon"
                variant="default"
                disabled={!isDocumentReady}
                aria-label="Send message"
                className="h-11 w-11 rounded-[var(--radius-pill)] bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-deep)] disabled:bg-[var(--color-rule)]"
            >
                <SendHorizontal className="h-5 w-5" />
            </Button>
        </div>
    </form>
);
