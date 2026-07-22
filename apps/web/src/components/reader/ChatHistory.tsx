import { Message } from "./MessageList";
import { Button } from "../ui/button";
import { MessageSquareText, PanelLeftClose, Plus } from "lucide-react";

export type Conversation = {
    id: string;
    title: string;
    messages?: Message[];
    createdAt: string;
    lastMessageAt?: string;
    resourceId?: string;
    resourceType?: string;
    userId?: string;
};

const formatConversationDate = (date: string | undefined) => {
    if (!date) return "";

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) return date;

    return parsedDate.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
    });
};

function ChatHistory({
    conversations,
    currentConversationId,
    isLoading,
    isError,
    onNewConversation,
    onHideHistory,
    onSelectConversation,
}: {
    conversations: Conversation[];
    currentConversationId?: string | null;
    isLoading?: boolean;
    isError?: boolean;
    onNewConversation: () => void;
    onHideHistory?: () => void;
    onSelectConversation: (conversation: Conversation) => void;
}) {
    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-[var(--color-chat-rule)] bg-[var(--color-chat-raised)] text-[var(--color-chat-text)]">
            <div className="shrink-0 border-b border-[var(--color-chat-rule)] p-4 md:px-6 md:pb-4 md:pt-6">
                <div className="flex items-center gap-2">
                    {onHideHistory && (
                        <button
                            type="button"
                            onClick={onHideHistory}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] text-[var(--color-chat-muted)] transition-[background-color,color] duration-short hover:bg-[var(--color-chat)] hover:text-[var(--color-chat-text)]"
                            aria-label="Hide previous chats"
                            title="Hide previous chats"
                        >
                            <PanelLeftClose className="h-[18px] w-[18px]" />
                        </button>
                    )}
                    <Button
                        onClick={onNewConversation}
                        size="sm"
                        variant="outline"
                        className="min-w-0 flex-1 justify-start gap-2 border-[var(--color-chat-rule)] bg-transparent text-[var(--color-chat-text)] hover:bg-[var(--color-chat)] hover:text-[var(--color-chat-text)] active:translate-y-px focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--color-accent-2)]"
                    >
                        <Plus className="h-4 w-4 shrink-0" />
                        <span className="truncate">New chat</span>
                    </Button>
                </div>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
                <div className="min-w-0 pb-4">
                    {isLoading && (
                        <div className="px-4 py-5 text-sm text-[var(--color-chat-muted)]">
                            Loading chats…
                        </div>
                    )}
                    {isError && (
                        <div className="px-4 py-5 text-sm text-[var(--color-accent-3-soft)]">
                            Unable to load chats.
                        </div>
                    )}
                    {!isLoading && !isError && conversations.length === 0 && (
                        <div className="px-4 py-5 text-sm leading-5 text-[var(--color-chat-muted)]">
                            No previous chats for this document.
                        </div>
                    )}
                    {!isLoading &&
                        !isError &&
                        conversations.map((conversation) => {
                            const isSelected =
                                conversation.id === currentConversationId;
                            return (
                                <button
                                    key={conversation.id}
                                    onClick={() =>
                                        onSelectConversation(conversation)
                                    }
                                    className={`min-h-16 w-full min-w-0 overflow-hidden border-b border-[var(--color-chat-rule)] p-4 text-left transition-colors hover:bg-[var(--color-chat)] active:bg-[var(--color-chat)] focus-visible:outline focus-visible:outline-[3px] focus-visible:-outline-offset-[3px] focus-visible:outline-[var(--color-accent-2)] ${
                                        isSelected
                                            ? "bg-[var(--color-chat)]"
                                            : ""
                                    }`}
                                >
                                    <div className="mb-1 flex min-w-0 items-center gap-2">
                                        <MessageSquareText className="h-4 w-4 shrink-0 text-[var(--color-accent-2)]" />
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-chat-text)]">
                                            {conversation.title}
                                        </span>
                                    </div>
                                    <span className="font-label text-xs text-[var(--color-chat-muted)]">
                                        {formatConversationDate(
                                            conversation.lastMessageAt ??
                                                conversation.createdAt
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                </div>
            </div>
        </div>
    );
}
export default ChatHistory;
