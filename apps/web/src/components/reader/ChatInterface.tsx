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
import {
    chatModelOptions,
    PLATFORM_CHAT_MODELS,
    useChatProviderStatus,
} from "@/lib/chatProvider";

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
    hasHighlightContext,
    children,
}: {
    isMobile: boolean;
    isExpanded: boolean;
    hasHighlightContext: boolean;
    children: React.ReactNode;
}) => {
    const layoutClasses = useMemo(() => {
        const baseClasses = `flex flex-col ${!isMobile && "h-full flex-1"} overflow-hidden`;
        const mobileClasses = isMobile
            ? `absolute bottom-4 w-[calc(100%-2rem)] left-1/2 -translate-x-1/2 rounded-[var(--radius-panel)] transition-all duration-short ${
                  isExpanded
                      ? "h-[80dvh] border border-[var(--color-chat-rule)] bg-[var(--color-chat)] text-[var(--color-chat-text)]"
                      : hasHighlightContext
                        ? "border border-[var(--color-chat-rule)] bg-[var(--color-chat)] text-[var(--color-chat-text)] shadow-xl p-3"
                        : "border border-transparent bg-transparent"
              }`
            : "";
        return `${baseClasses} ${mobileClasses} ${!isMobile ? "bg-[var(--color-chat)]" : ""}`;
    }, [isMobile, isExpanded, hasHighlightContext]);

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
    const chatProviderQuery = useChatProviderStatus();
    const modelOptions = chatProviderQuery.data
        ? chatModelOptions(chatProviderQuery.data)
        : PLATFORM_CHAT_MODELS;
    const [selectedModel, setSelectedModel] = useState(
        PLATFORM_CHAT_MODELS[0].value as string
    );
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
        if (!highlightContext || !isDocumentReady) return;

        if (!isMobile) {
            inputRef.current?.focus();
        }
    }, [highlightContext, isDocumentReady, isMobile]);

    useEffect(() => {
        const status = chatProviderQuery.data;
        if (!status) return;
        if (!status.models.includes(selectedModel)) {
            setSelectedModel(status.defaultModel);
        }
    }, [chatProviderQuery.data, selectedModel]);

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
            <ChatLayout
                isMobile={isMobile}
                isExpanded={chatState.isExpanded}
                hasHighlightContext={Boolean(highlightContext)}
            >
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
                    <MobileChatToolbar
                        title={
                            chatState.isHistoryOpen ? "Previous chats" : "Chat"
                        }
                        onClose={handleMobileChatClose}
                    />
                )}
                {isMobile &&
                    chatState.isChatOpen &&
                    chatState.isHistoryOpen && (
                        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
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
                    isMobile={isMobile}
                    isExpanded={chatState.isExpanded}
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
                    isProviderStatusPending={!chatProviderQuery.data}
                    canRetryProcessing={canRetryProcessing}
                    isRetrying={isRetrying}
                    retryError={retryError ? retryError.message : null}
                    onRetryProcessing={() => void retryProcessing()}
                    highlightContext={highlightContext}
                    onClearHighlightContext={onClearHighlightContext}
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    modelOptions={modelOptions}
                    inputRef={inputRef}
                    showModelSelector={
                        !isMobile ||
                        (isComposerFocused && !chatState.isHistoryOpen)
                    }
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

const MobileChatToolbar = ({
    title,
    onClose,
}: {
    title: string;
    onClose: () => void;
}) => {
    return (
        <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-[var(--color-chat-rule)] px-3 py-2">
            <span className="font-label text-xs font-semibold text-[var(--color-chat-muted)]">
                {title}
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
    isMobile = false,
    isExpanded = false,
    input,
    setInput,
    handleSubmit,
    isDocumentReady,
    isCheckingStatus,
    isProviderStatusPending,
    processingError,
    canRetryProcessing,
    isRetrying,
    retryError,
    onRetryProcessing,
    highlightContext,
    onClearHighlightContext,
    selectedModel,
    setSelectedModel,
    modelOptions,
    inputRef,
    showModelSelector,
    onComposerFocusChange,
    onHistoryClick,
    showHistoryButton,
    historyButtonLabel,
    isHistoryButtonActive,
}: {
    isMobile?: boolean;
    isExpanded?: boolean;
    input: string;
    setInput: (value: string) => void;
    handleSubmit: (e: React.FormEvent) => void;
    isDocumentReady: boolean;
    isCheckingStatus: boolean;
    processingError: string | null;
    isProviderStatusPending: boolean;
    canRetryProcessing: boolean;
    isRetrying: boolean;
    retryError: string | null;
    onRetryProcessing: () => void;
    highlightContext: HighlightContext | null;
    onClearHighlightContext?: () => void;
    selectedModel: string;
    setSelectedModel: (value: string) => void;
    modelOptions: ReadonlyArray<{ value: string; label: string }>;
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
        onBlur={(event) => {
            const nextFocused = event.relatedTarget as Node | null;
            if (!event.currentTarget.contains(nextFocused)) {
                onComposerFocusChange(false);
            }
        }}
        className={`mt-auto shrink-0 ${
            isMobile && !isExpanded && highlightContext ? "p-0" : "p-6 md:p-8"
        }`}
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
                        disabled={isProviderStatusPending}
                        aria-label="Chat model"
                        className="h-11 appearance-none rounded-[var(--radius-input)] border border-[var(--color-chat-rule)] bg-[var(--color-chat-raised)] pl-3 pr-8 text-sm font-semibold text-[var(--color-chat-text)] outline-none transition-[background-color,border-color] duration-short hover:bg-[var(--color-chat)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--color-accent-2)]"
                    >
                        {modelOptions.map((model) => (
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
            <div className="mb-2 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-chat-rule)] bg-[var(--color-chat-raised)] px-3 py-1.5 text-xs text-[var(--color-chat-text)]">
                <Quote className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent-2)]" />
                <span
                    className="font-semibold text-[var(--color-chat-text)]"
                    title={highlightContext.text}
                >
                    1 context added
                </span>
                {onClearHighlightContext && (
                    <button
                        type="button"
                        onClick={onClearHighlightContext}
                        className="ml-1 grid h-5 w-5 place-items-center rounded-full text-[var(--color-chat-muted)] transition-colors hover:bg-[var(--color-chat)] hover:text-[var(--color-chat-text)] focus-visible:outline focus-visible:outline-[2px] focus-visible:outline-[var(--color-accent-2)]"
                        aria-label="Remove context"
                        title="Remove context"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
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
                onFocus={() => onComposerFocusChange(true)}
                onPointerDown={() => onComposerFocusChange(true)}
                placeholder={
                    isDocumentReady
                        ? "Ask about this document..."
                        : processingError
                          ? "Document text processing failed"
                          : "Document context is processing..."
                }
                className="h-11 flex-1 border-0 bg-transparent px-2 font-sans text-sm font-semibold text-[var(--color-ink)] shadow-none outline-none placeholder:text-[var(--color-ink-soft)] focus-visible:outline-none"
                disabled={!isDocumentReady || isProviderStatusPending}
            />
            <Button
                type="submit"
                size="icon"
                variant="default"
                disabled={!isDocumentReady || isProviderStatusPending}
                aria-label="Send message"
                className="h-11 w-11 rounded-[var(--radius-pill)] bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-deep)] disabled:bg-[var(--color-rule)]"
            >
                <SendHorizontal className="h-5 w-5" />
            </Button>
        </div>
    </form>
);
