"use client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, SendHorizontal, History } from "lucide-react";
import { useMemo } from "react";
import MessageList, { Message } from "./MessageList";
import ChatHistory from "./ChatHistory";
import useConversations from "@/hooks/chat/useConversations";
import { useChat } from "@/hooks/chat/useChat";
import { useBookProcessingStatus } from "@/hooks/useBookProcessingStatus";

interface ChatInterfaceProps {
    isMobile?: boolean;
    bookId: string;
    onBack?: () => void;
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
            ? `absolute bottom-4 w-[calc(100%-2rem)] left-1/2 -translate-x-1/2 rounded-2xl shadow-[0px_18px_50px_rgba(0,0,0,0.28)] ${
                  isExpanded ? "h-[80dvh] bg-[#343541]" : "bg-transparent"
              }`
            : "";
        return `${baseClasses} ${mobileClasses} ${!isMobile ? "bg-[#343541]" : ""}`;
    }, [isMobile, isExpanded]);

    return <div className={layoutClasses}>{children}</div>;
};

export function ChatInterface({
    isMobile = false,
    bookId,
    onBack,
}: ChatInterfaceProps) {
    const { data: conversationsData, refetch: refetchConversations } =
        useConversations(bookId);
    const { data: processingStatus } = useBookProcessingStatus(bookId);
    const isDocumentReady = processingStatus?.ready ?? false;
    const processingError =
        processingStatus?.status === "failed"
            ? processingStatus.error ||
              "Document text processing failed. This PDF may be scanned or image-only, and OCR is not enabled yet."
            : null;
    const {
        chatState,
        handleSelectConversation,
        handleSubmit,
        input,
        setChatState,
        setInput,
    } = useChat(bookId);

    return (
        <div className={`relative flex ${!isMobile && "h-full w-full"}`}>
            {!isMobile && chatState.isHistoryOpen && (
                <div className="max-w-[44%] overflow-x-hidden">
                    <ChatHistory
                        conversations={conversationsData?.conversations}
                        onSelectConversation={handleSelectConversation}
                    />
                </div>
            )}
            <ChatLayout isMobile={isMobile} isExpanded={chatState.isExpanded}>
                {!isMobile && onBack && (
                    <div className="shrink-0 px-6 pt-6 md:px-8 md:pt-8">
                        <button
                            type="button"
                            onClick={onBack}
                            className="group flex items-center gap-2 rounded-lg p-2 pr-3 text-sm font-semibold text-[#f1f1f1] transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <ArrowLeft className="h-5 w-5 transition-transform group-hover:-translate-x-1" />
                            <span>Back</span>
                        </button>
                    </div>
                )}
                {isMobile &&
                    chatState.isChatOpen &&
                    chatState.isHistoryOpen && (
                        <div className="overflow-scroll h-full">
                            <ChatHistory
                                conversations={conversationsData.conversations}
                                onSelectConversation={handleSelectConversation}
                            />
                        </div>
                    )}
                {chatState.isChatOpen && !chatState.isHistoryOpen && (
                    <ChatMessages
                        messages={chatState.messages}
                        isMobile={isMobile}
                        isExpanded={chatState.isExpanded}
                    />
                )}
                <ChatInput
                    input={input}
                    setInput={setInput}
                    handleSubmit={handleSubmit}
                    isDocumentReady={isDocumentReady}
                    isCheckingStatus={!processingStatus}
                    processingError={processingError}
                    onHistoryClick={() => {
                        refetchConversations();
                        setChatState((prev) => ({
                            ...prev,
                            isHistoryOpen: !prev.isHistoryOpen,
                            isChatOpen: true,
                            isExpanded: true,
                        }));
                    }}
                />
            </ChatLayout>
        </div>
    );
}

const ChatMessages = ({
    messages,
    isMobile,
    isExpanded,
}: {
    messages: Message[];
    isMobile: boolean;
    isExpanded: boolean;
}) => (
    <div className="min-h-0 flex-1">
        <MessageList
            messages={messages}
            isMobile={isMobile}
            isExpanded={isExpanded}
        />
    </div>
);

const ChatInput = ({
    input,
    setInput,
    handleSubmit,
    isDocumentReady,
    isCheckingStatus,
    processingError,
    onHistoryClick,
}: {
    input: string;
    setInput: (value: string) => void;
    handleSubmit: (e: React.FormEvent) => void;
    isDocumentReady: boolean;
    isCheckingStatus: boolean;
    processingError: string | null;
    onHistoryClick: () => void;
}) => (
    <form onSubmit={handleSubmit} className="mt-auto shrink-0 p-6 md:p-8">
        {!isDocumentReady && (
            <div
                className={`mb-2 rounded-md border px-3 py-2 text-sm ${
                    processingError
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
            >
                {processingError ||
                    (isCheckingStatus
                        ? "Checking document processing status..."
                        : "Document context is still processing. You can ask questions once it is ready.")}
            </div>
        )}
        <div className="flex items-center gap-2 rounded-full bg-white py-2 pl-2 pr-3 shadow-[0px_10px_30px_rgba(0,0,0,0.15)]">
            <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={onHistoryClick}
                className="h-10 w-10 rounded-full text-[#616363] hover:bg-[#eeeeee] hover:text-[#1a1c1c]"
            >
                <History className="h-5 w-5" />
            </Button>
            <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                    isDocumentReady
                        ? "Ask about this document..."
                        : processingError
                          ? "Document text processing failed"
                          : "Document context is processing..."
                }
                className="h-11 flex-1 border-0 bg-transparent px-2 font-sans text-sm font-semibold text-[#1a1c1c] shadow-none ring-0 placeholder:text-[#9ea3a8] focus-visible:ring-0 focus-visible:ring-offset-0"
                disabled={!isDocumentReady}
            />
            <Button
                type="submit"
                size="icon"
                variant="default"
                disabled={!isDocumentReady}
                className="h-10 w-10 rounded-full bg-[#5c5d66] text-white hover:bg-[#4f5058] disabled:bg-[#c6c6c7]"
            >
                <SendHorizontal className="h-5 w-5" />
            </Button>
        </div>
    </form>
);
