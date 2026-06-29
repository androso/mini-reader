import { ScrollArea } from "@radix-ui/react-scroll-area";
import { Message } from "./MessageList";
import { Button } from "../ui/button";
import { MessageSquareText, Plus } from "lucide-react";

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
    onSelectConversation,
}: {
    conversations: Conversation[];
    currentConversationId?: string | null;
    isLoading?: boolean;
    isError?: boolean;
    onNewConversation: () => void;
    onSelectConversation: (conversation: Conversation) => void;
}) {
    return (
        <div className="h-full border-r border-white/10 bg-[#2f3039] text-white">
            <div className="border-b border-white/10 p-4">
                <Button
                    onClick={onNewConversation}
                    size="sm"
                    variant="outline"
                    className="w-full justify-start gap-2 border-white/15 bg-transparent text-[#f1f1f1] hover:bg-white/10 hover:text-white"
                >
                    <Plus className="h-4 w-4 shrink-0" />
                    <span className="truncate">New chat</span>
                </Button>
            </div>
            <ScrollArea className="h-full">
                <div className="pb-16">
                    {isLoading && (
                        <div className="px-4 py-5 text-sm text-[#c6c5d4]">
                            Loading chats...
                        </div>
                    )}
                    {isError && (
                        <div className="px-4 py-5 text-sm text-red-200">
                            Unable to load chats.
                        </div>
                    )}
                    {!isLoading && !isError && conversations.length === 0 && (
                        <div className="px-4 py-5 text-sm leading-5 text-[#c6c5d4]">
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
                                    className={`w-full border-b border-white/10 p-4 text-left transition-colors hover:bg-white/10 ${
                                        isSelected ? "bg-white/10" : ""
                                    }`}
                                >
                                    <div className="mb-1 flex items-center gap-2">
                                        <MessageSquareText className="h-4 w-4 shrink-0 text-[#c6c5d4]" />
                                        <span className="truncate text-sm font-medium text-[#f1f1f1]">
                                            {conversation.title}
                                        </span>
                                    </div>
                                    <span className="text-xs text-[#9e9dac]">
                                        {formatConversationDate(
                                            conversation.lastMessageAt ??
                                                conversation.createdAt
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                </div>
            </ScrollArea>
        </div>
    );
}
export default ChatHistory;
