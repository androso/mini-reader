import { ScrollArea } from "@radix-ui/react-scroll-area";
import { Sparkles } from "lucide-react";
import { memo } from "react";

export type Message = {
    role: string;
    content: string;
};

const MessageList = memo(
    ({
        messages,
        isMobile,
        isExpanded,
    }: {
        messages: Message[];
        isMobile: boolean;
        isExpanded: boolean;
    }) => {
        return (
            <ScrollArea
                className={`${isMobile ? (isExpanded ? "h-full" : "h-[200px]") : "h-full"} space-y-3 overflow-y-scroll p-6 md:p-8`}
            >
                {(isMobile && !isExpanded ? messages.slice(-2) : messages)
                    .filter(Boolean)
                    .map((message: Message, index: number) => {
                        const isAssistant = message.role === "assistant";

                        return (
                            <div
                                key={index}
                                className={`mb-4 flex flex-col gap-2 ${
                                    isAssistant ? "items-start" : "items-end"
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    {isAssistant && (
                                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-[#1f202b] text-white">
                                            <Sparkles className="h-4 w-4" />
                                        </div>
                                    )}
                                    <span className="font-sans text-xs font-medium leading-4 text-[#9e9dac]/70">
                                        {isAssistant ? "Mentarie" : "You"}
                                    </span>
                                    {!isAssistant && (
                                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#5d5f5f] text-xs font-bold text-white">
                                            U
                                        </div>
                                    )}
                                </div>
                                <div
                                    className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                                        isAssistant
                                            ? "rounded-tl-none border border-white/5 bg-[#3e3f4b] text-[#c6c5d4]"
                                            : "rounded-tr-none bg-[#444654] text-white"
                                    }`}
                                >
                                    <p className="whitespace-pre-wrap font-sans text-sm font-semibold leading-relaxed">
                                        {message.content}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
            </ScrollArea>
        );
    }
);
MessageList.displayName = "MessageList";
export default MessageList;
