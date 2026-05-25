import { ScrollArea } from "@radix-ui/react-scroll-area";
import { Message } from "./MessageList";
import { Button } from "../ui/button";
import { MessageSquareText } from "lucide-react";

export type Conversation = {
    id: string;
    title: string;
    messages: Message[];
    createdAt: string;
    lastMessageAt?: string;
    resourceId?: string;
    resourceType?: string;
    userId?: string;
};

function ChatHistory({
    conversations,
    onSelectConversation,
}: {
    conversations: Conversation[];
    onSelectConversation: (conversation: Conversation) => void;
}) {
    const handleNewThread = () => {
        onSelectConversation({
            id: Date.now().toString(),
            title: "New Conversation",
            createdAt: new Date().toISOString().split("T")[0],
            messages: [],
        });
    };

    return (
        <div className="h-full border-r border-white/10 bg-[#2f3039] text-white">
            <div className="border-b border-white/10 p-4">
                <div className="flex justify-between items-center">
                    <Button
                        onClick={handleNewThread}
                        size="sm"
                        variant="outline"
                        className="border-white/15 bg-transparent text-[#f1f1f1] hover:bg-white/10 hover:text-white"
                    >
                        Start new thread
                    </Button>
                </div>
            </div>
            <ScrollArea className="h-full">
                {conversations.map((conversation) => (
                    <button
                        key={conversation.id}
                        onClick={() => onSelectConversation(conversation)}
                        className="w-full border-b border-white/10 p-4 text-left transition-colors hover:bg-white/10"
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <MessageSquareText className="h-4 w-4 text-[#c6c5d4]" />
                            <span className="text-sm font-medium text-[#f1f1f1]">
                                {conversation.title}
                            </span>
                        </div>
                        <span className="text-xs text-[#9e9dac]">
                            {conversation.lastMessageAt ??
                                conversation.createdAt}
                        </span>
                    </button>
                ))}
            </ScrollArea>
        </div>
    );
}
export default ChatHistory;
