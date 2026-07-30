import { useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Keyboard,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNetInfo } from "@react-native-community/netinfo";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
    ChatMessage,
    ChatStreamEvent,
    Conversation,
    HighlightContext,
} from "@reader/contracts";
import { apiFetch, apiJson } from "@/lib/api";
import { chatModelLabel } from "@/lib/chatModelLabel";
import { chatOverlayBottom } from "@/lib/keyboardInset";
import { createSseParserState, pushSseChunk } from "@/lib/sse";
import { ActionButton } from "./ActionButton";
import { allowedUrlsFromSources, ChatMarkdown } from "./ChatMarkdown";
import { MessageSources } from "./MessageSources";
import { color, radius, space, type } from "@/theme/tokens";

type ProviderStatus = {
    models: string[];
    defaultModel: string;
};

const conversationKey = (bookId: string) => ["conversations", bookId];

const updateAssistant = (
    messages: ChatMessage[],
    event: ChatStreamEvent
): ChatMessage[] => {
    const next = [...messages];
    const index = next.length - 1;
    const message = next[index];
    if (!message || message.role !== "assistant") return next;
    if ("content" in event) {
        next[index] = { ...message, content: message.content + event.content };
    } else if ("type" in event && event.type === "sources") {
        next[index] = { ...message, contextSources: event.sources };
    } else if ("type" in event && event.type === "terminal") {
        next[index] = {
            ...message,
            completionStatus: event.status,
            finishReason: event.finishReason,
        };
    } else if ("error" in event) {
        next[index] = {
            ...message,
            content: event.error,
            completionStatus: "failed",
        };
    }
    return next;
};

export const ReaderChat = ({
    bookId,
    isTablet,
    highlightContext,
    onClearHighlight,
}: {
    bookId: string;
    isTablet: boolean;
    highlightContext: HighlightContext | null;
    onClearHighlight(): void;
}) => {
    const network = useNetInfo();
    const queryClient = useQueryClient();
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const messageScroll = useRef<ScrollView>(null);
    const [expanded, setExpanded] = useState(isTablet);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [conversation, setConversation] = useState<Conversation | null>(null);
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState("");
    const [modelPickerOpen, setModelPickerOpen] = useState(false);
    const [keyboardHeight, setKeyboardHeight] = useState(0);

    useEffect(() => {
        if (isTablet) setExpanded(true);
    }, [isTablet]);

    useEffect(() => {
        // Lift only the chat overlay instead of resizing the WebView reader shell.
        if (isTablet) {
            setKeyboardHeight(0);
            return;
        }
        const showEvent =
            Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
        const hideEvent =
            Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
        const show = Keyboard.addListener(showEvent, (event) => {
            setKeyboardHeight(event.endCoordinates.height);
        });
        const hide = Keyboard.addListener(hideEvent, () => {
            setKeyboardHeight(0);
        });
        return () => {
            show.remove();
            hide.remove();
        };
    }, [isTablet]);

    const provider = useQuery({
        queryKey: ["chat-provider"],
        queryFn: () => apiJson<ProviderStatus>("/api/chat-provider"),
        retry: false,
    });
    const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
    useEffect(() => {
        if (provider.data?.defaultModel) {
            setSelectedModel(provider.data.defaultModel);
        }
    }, [provider.data?.defaultModel]);
    const conversations = useQuery({
        queryKey: conversationKey(bookId),
        queryFn: async () =>
            (
                await apiJson<{ conversations: Conversation[] }>(
                    `/api/book/${bookId}/conversations`
                )
            ).conversations,
        enabled: expanded || historyOpen,
    });

    const online = network.isConnected !== false;
    const openHistory = () => {
        setExpanded(true);
        setHistoryOpen(true);
        void conversations.refetch();
    };
    const newConversation = () => {
        setConversation(null);
        setMessages([]);
        setHistoryOpen(false);
        setExpanded(true);
        setError("");
    };
    const selectConversation = async (selected: Conversation) => {
        setConversation(selected);
        setHistoryOpen(false);
        setExpanded(true);
        setError("");
        const payload = await apiJson<{ messages: ChatMessage[] }>(
            `/api/book/${bookId}/conversations/${selected.id}`
        );
        setMessages(payload.messages);
    };

    const submit = async () => {
        const message = input.trim();
        if (!message || streaming || !online) return;
        setExpanded(true);
        setHistoryOpen(false);
        setInput("");
        setError("");
        setMessages((current) => [
            ...current,
            {
                id: `local-user-${Date.now()}`,
                role: "user",
                content: message,
            },
            {
                id: `local-assistant-${Date.now()}`,
                role: "assistant",
                content: "",
            },
        ]);
        setStreaming(true);
        try {
            const endpoint = conversation
                ? `/api/book/${bookId}/conversations/${conversation.id}/messages`
                : `/api/book/${bookId}/conversations`;
            const response = await apiFetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message,
                    model: selectedModel,
                    ...(highlightContext ? { highlightContext } : {}),
                }),
            });
            if (!response.ok || !response.body) {
                throw new Error("Mentarie couldn’t start this answer.");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const parser = createSseParserState();
            let conversationId: string | null = null;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const events = pushSseChunk(
                    parser,
                    decoder.decode(value, { stream: true })
                );
                for (const event of events) {
                    if ("type" in event && event.type === "conversation_id") {
                        conversationId = event.conversationId;
                    } else {
                        setMessages((current) =>
                            updateAssistant(current, event)
                        );
                    }
                }
            }
            if (!conversation && conversationId) {
                setConversation({
                    id: conversationId,
                    title: `${message.slice(0, 50)}…`,
                    resourceType: "book",
                    resourceId: bookId,
                    createdAt: new Date().toISOString(),
                    lastMessageAt: new Date().toISOString(),
                });
            }
            if (highlightContext) onClearHighlight();
            await queryClient.invalidateQueries({
                queryKey: conversationKey(bookId),
            });
        } catch (caught) {
            const message =
                caught instanceof Error
                    ? caught.message
                    : "The answer couldn’t be completed.";
            setError(`${message} Check the connection and try again.`);
            setMessages((current) =>
                updateAssistant(current, { error: message })
            );
        } finally {
            setStreaming(false);
        }
    };

    const models = useMemo(
        () => provider.data?.models ?? ["gpt-4o-mini"],
        [provider.data?.models]
    );
    const suggestedPrompts = useMemo(
        () =>
            highlightContext
                ? [
                      "Explain this passage",
                      "What supports this claim?",
                      "Connect this to the chapter",
                  ]
                : [
                      "Summarize the core argument",
                      "List the key evidence",
                      "What should I question?",
                  ],
        [highlightContext]
    );
    const panelStyle = useMemo<StyleProp<ViewStyle>>(() => {
        if (isTablet) return styles.tabletPanel;

        const bottom = chatOverlayBottom({
            keyboardHeight,
            safeBottom: insets.bottom,
            restingGap: space.md,
            keyboardGap: space.xs,
        });
        const keyboardOpen = keyboardHeight > 0;

        if (expanded) {
            // Lift with the IME, but keep a compact sheet so the panel does not
            // stretch edge-to-edge (and briefly overflow) while Gboard opens.
            if (keyboardOpen) {
                const available = windowHeight - keyboardHeight - space.md;
                return {
                    position: "absolute",
                    left: space.md,
                    right: space.md,
                    bottom,
                    height: Math.min(
                        windowHeight * 0.5,
                        Math.max(available, 0)
                    ),
                    borderRadius: radius.panel,
                    borderWidth: 1,
                };
            }
            return [styles.expandedPanel, { bottom }];
        }

        return [
            styles.composerPanel,
            { bottom },
            keyboardOpen && styles.composerPanelRaised,
        ];
    }, [expanded, insets.bottom, isTablet, keyboardHeight, windowHeight]);

    return (
        <View pointerEvents="box-none" style={[styles.panel, panelStyle]}>
            {(expanded || isTablet) && (
                <View style={styles.toolbar}>
                    <ActionButton
                        label="History"
                        icon="clock"
                        tone="quiet"
                        compact
                        onPress={openHistory}
                    />
                    <Text numberOfLines={1} style={styles.toolbarTitle}>
                        {historyOpen ? "Previous chats" : "Ask this book"}
                    </Text>
                    {!isTablet && (
                        <ActionButton
                            label="Close"
                            icon="x"
                            tone="quiet"
                            compact
                            onPress={() => {
                                setExpanded(false);
                                setHistoryOpen(false);
                            }}
                        />
                    )}
                </View>
            )}
            {(expanded || isTablet) && (
                <View style={styles.body}>
                    {historyOpen ? (
                        <ScrollView
                            contentContainerStyle={styles.history}
                            keyboardShouldPersistTaps="handled"
                        >
                            <ActionButton
                                label="New chat"
                                icon="plus"
                                tone="secondary"
                                onPress={newConversation}
                            />
                            {conversations.isLoading && (
                                <ActivityIndicator color={color.accent} />
                            )}
                            {!conversations.isLoading &&
                                conversations.data?.length === 0 && (
                                    <Text style={styles.empty}>
                                        No previous chats for this book.
                                    </Text>
                                )}
                            {conversations.data?.map((item) => (
                                <Pressable
                                    key={item.id}
                                    accessibilityRole="button"
                                    onPress={() =>
                                        void selectConversation(item)
                                    }
                                    style={({ pressed }) => [
                                        styles.historyItem,
                                        item.id === conversation?.id &&
                                            styles.historySelected,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Feather
                                        name="message-square"
                                        color={color.accentSoft}
                                        size={17}
                                    />
                                    <View style={styles.historyText}>
                                        <Text
                                            numberOfLines={1}
                                            style={styles.historyTitle}
                                        >
                                            {item.title}
                                        </Text>
                                        <Text style={styles.historyDate}>
                                            {new Date(
                                                item.lastMessageAt ??
                                                    item.createdAt
                                            ).toLocaleDateString()}
                                        </Text>
                                    </View>
                                </Pressable>
                            ))}
                        </ScrollView>
                    ) : (
                        <ScrollView
                            ref={messageScroll}
                            contentContainerStyle={styles.messages}
                            onContentSizeChange={() =>
                                messageScroll.current?.scrollToEnd({
                                    animated: true,
                                })
                            }
                            keyboardShouldPersistTaps="handled"
                        >
                            {messages.length === 0 && (
                                <View style={styles.welcome}>
                                    <Text style={styles.welcomeTitle}>
                                        Ask beside the page.
                                    </Text>
                                    <Text style={styles.empty}>
                                        Answers use the current book as
                                        evidence. Select EPUB text to add a
                                        specific passage.
                                    </Text>
                                    <View style={styles.promptList}>
                                        {suggestedPrompts.map((prompt) => (
                                            <Pressable
                                                key={prompt}
                                                accessibilityRole="button"
                                                accessibilityLabel={prompt}
                                                onPress={() => setInput(prompt)}
                                                style={({ pressed }) => [
                                                    styles.prompt,
                                                    pressed &&
                                                        styles.promptPressed,
                                                ]}
                                            >
                                                <Text
                                                    numberOfLines={1}
                                                    style={styles.promptText}
                                                >
                                                    {prompt}
                                                </Text>
                                                <Feather
                                                    name="arrow-up-right"
                                                    size={16}
                                                    color={color.accentSoft}
                                                />
                                            </Pressable>
                                        ))}
                                    </View>
                                </View>
                            )}
                            {messages.map((message, index) => (
                                <View
                                    key={message.id ?? index}
                                    style={[
                                        styles.messageRow,
                                        message.role === "user" &&
                                            styles.messageRowUser,
                                    ]}
                                >
                                    <Text style={styles.messageAuthor}>
                                        {message.role === "assistant"
                                            ? "Mentarie"
                                            : "You"}
                                    </Text>
                                    <View
                                        style={[
                                            styles.message,
                                            message.role === "user"
                                                ? styles.userMessage
                                                : styles.assistantMessage,
                                        ]}
                                    >
                                        {streaming &&
                                        index === messages.length - 1 &&
                                        !message.content ? (
                                            <ActivityIndicator
                                                color={color.accentSoft}
                                            />
                                        ) : message.role === "assistant" ? (
                                            <ChatMarkdown
                                                content={message.content}
                                                allowedUrls={allowedUrlsFromSources(
                                                    message.contextSources
                                                )}
                                            />
                                        ) : (
                                            <Text
                                                selectable
                                                style={[
                                                    styles.messageText,
                                                    styles.userMessageText,
                                                ]}
                                            >
                                                {message.content}
                                            </Text>
                                        )}
                                    </View>
                                    {message.contextSources &&
                                        message.contextSources.length > 0 && (
                                            <MessageSources
                                                sources={message.contextSources}
                                            />
                                        )}
                                </View>
                            ))}
                        </ScrollView>
                    )}
                </View>
            )}
            {!historyOpen && (
                <View style={styles.composerArea}>
                    {highlightContext && (
                        <View
                            style={styles.contextCard}
                            accessibilityLiveRegion="polite"
                            accessibilityLabel="Selected passage added to the next question"
                        >
                            <View style={styles.contextHeading}>
                                <Feather
                                    name="bookmark"
                                    size={15}
                                    color={color.ink}
                                />
                                <Text style={styles.contextLabel}>
                                    Selected passage
                                </Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Remove selected passage"
                                    hitSlop={12}
                                    onPress={onClearHighlight}
                                    style={styles.contextRemove}
                                >
                                    <Feather
                                        name="x"
                                        size={17}
                                        color={color.ink}
                                    />
                                </Pressable>
                            </View>
                            <Text numberOfLines={2} style={styles.contextText}>
                                “{highlightContext.text}”
                            </Text>
                        </View>
                    )}
                    <View style={styles.composer}>
                        <View style={styles.composerMeta}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Model: ${chatModelLabel(selectedModel)}`}
                                onPress={() => setModelPickerOpen(true)}
                                style={({ pressed }) => [
                                    styles.modelButton,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Feather
                                    name="cpu"
                                    size={14}
                                    color={color.accentSoft}
                                />
                                <Text
                                    numberOfLines={1}
                                    style={styles.modelLabel}
                                >
                                    {chatModelLabel(selectedModel)}
                                </Text>
                                <Feather
                                    name="chevron-down"
                                    size={15}
                                    color={color.darkInk2}
                                />
                            </Pressable>
                            <Text style={styles.groundingLabel}>
                                {online ? "Grounded in this book" : "Offline"}
                            </Text>
                        </View>
                        <View style={styles.askRow}>
                            <TextInput
                                value={input}
                                onChangeText={setInput}
                                editable={!streaming && online}
                                multiline
                                maxLength={8000}
                                placeholder={
                                    online
                                        ? "Ask a question"
                                        : "Chat needs a connection"
                                }
                                placeholderTextColor={color.darkInk2}
                                accessibilityLabel="Ask about this book"
                                style={styles.input}
                                onFocus={() => {
                                    if (!isTablet) setExpanded(true);
                                }}
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Ask"
                                accessibilityState={{
                                    disabled:
                                        !input.trim() || streaming || !online,
                                    busy: streaming,
                                }}
                                disabled={!input.trim() || streaming || !online}
                                onPress={() => void submit()}
                                style={({ pressed }) => [
                                    styles.send,
                                    pressed && styles.pressed,
                                    (!input.trim() || streaming || !online) &&
                                        styles.disabled,
                                ]}
                            >
                                {streaming ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={color.darkInk}
                                    />
                                ) : (
                                    <Feather
                                        name="arrow-up"
                                        size={20}
                                        color={color.darkInk}
                                    />
                                )}
                            </Pressable>
                        </View>
                    </View>
                    <Text accessibilityLiveRegion="polite" style={styles.error}>
                        {error ||
                            (!online ? "Chat is unavailable offline." : " ")}
                    </Text>
                </View>
            )}
            <Modal
                visible={modelPickerOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setModelPickerOpen(false)}
            >
                <Pressable
                    style={styles.modalBackdrop}
                    onPress={() => setModelPickerOpen(false)}
                >
                    <View style={styles.modelSheet}>
                        <Text style={styles.modelHeading}>Choose model</Text>
                        {models.map((model) => (
                            <ActionButton
                                key={model}
                                label={chatModelLabel(model)}
                                icon={
                                    model === selectedModel ? "check" : "circle"
                                }
                                tone={
                                    model === selectedModel
                                        ? "primary"
                                        : "secondary"
                                }
                                onPress={() => {
                                    setSelectedModel(model);
                                    setModelPickerOpen(false);
                                }}
                            />
                        ))}
                    </View>
                </Pressable>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    panel: {
        backgroundColor: color.darkPaper,
        borderColor: color.darkRaised,
        overflow: "hidden",
        zIndex: 20,
    },
    composerPanel: {
        position: "absolute",
        left: space.md,
        right: space.md,
        bottom: space.md,
        borderRadius: radius.panel,
        backgroundColor: color.transparent,
        borderWidth: 0,
    },
    composerPanelRaised: {
        backgroundColor: color.darkPaper,
        borderWidth: 1,
    },
    expandedPanel: {
        position: "absolute",
        left: space.md,
        right: space.md,
        bottom: space.md,
        height: "80%",
        borderRadius: radius.panel,
        borderWidth: 1,
    },
    tabletPanel: {
        flex: 1,
        height: "100%",
        borderLeftWidth: 1,
        borderRadius: 0,
    },
    toolbar: {
        minHeight: 64,
        paddingHorizontal: space.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        borderBottomWidth: 1,
        borderBottomColor: color.darkRaised,
    },
    toolbarTitle: {
        flex: 1,
        color: color.darkInk,
        textAlign: "center",
        fontFamily: type.semibold,
        fontSize: 15,
    },
    body: { flex: 1, minHeight: 0 },
    history: { paddingBottom: space.lg },
    historyItem: {
        minHeight: 68,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderBottomWidth: 1,
        borderBottomColor: color.darkRaised,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
    },
    historySelected: { backgroundColor: color.darkRaised },
    historyText: { flex: 1, minWidth: 0, gap: space.xxs },
    historyTitle: {
        color: color.darkInk,
        fontFamily: type.medium,
        fontSize: 14,
    },
    historyDate: {
        color: color.darkInk2,
        fontFamily: type.mono,
        fontSize: 11,
    },
    messages: { padding: space.md, paddingBottom: space.lg, gap: space.md },
    welcome: {
        gap: space.xs,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: color.darkRaised,
    },
    welcomeTitle: {
        color: color.darkInk,
        fontFamily: type.semibold,
        fontSize: 18,
    },
    empty: {
        color: color.darkInk2,
        fontFamily: type.body,
        fontSize: 14,
        lineHeight: 21,
    },
    promptList: { marginTop: space.xs },
    prompt: {
        minHeight: 44,
        borderTopWidth: 1,
        borderTopColor: color.ink2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.sm,
    },
    promptPressed: { opacity: 0.68 },
    promptText: {
        flex: 1,
        color: color.darkInk,
        fontFamily: type.medium,
        fontSize: 14,
    },
    messageRow: { alignItems: "flex-start", gap: space.xs },
    messageRowUser: { alignItems: "flex-end" },
    messageAuthor: {
        color: color.darkInk2,
        fontFamily: type.mono,
        fontSize: 11,
    },
    message: {
        maxWidth: "88%",
        padding: space.sm,
        borderRadius: radius.md,
    },
    assistantMessage: {
        backgroundColor: color.darkRaised,
        borderTopLeftRadius: radius.sm,
    },
    userMessage: {
        backgroundColor: color.accentSoft,
        borderTopRightRadius: radius.sm,
    },
    messageText: {
        color: color.darkInk,
        fontFamily: type.body,
        fontSize: 15,
        lineHeight: 23,
    },
    userMessageText: { color: color.ink },
    composerArea: {
        padding: space.sm,
        paddingBottom: space.xs,
        gap: space.xs,
    },
    contextCard: {
        maxWidth: "100%",
        padding: space.sm,
        borderRadius: radius.md,
        backgroundColor: color.accentSoft,
        gap: space.xxs,
    },
    contextHeading: {
        minHeight: 28,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
    },
    contextLabel: {
        flex: 1,
        color: color.ink,
        fontFamily: type.semibold,
        fontSize: 12,
    },
    contextRemove: {
        width: 32,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.pill,
    },
    contextText: {
        color: color.ink,
        fontFamily: type.body,
        fontSize: 13,
        lineHeight: 19,
    },
    composer: {
        minHeight: 96,
        padding: space.xs,
        borderWidth: 1,
        borderColor: color.darkRaised,
        borderRadius: radius.lg,
        backgroundColor: color.darkRaised,
        gap: space.xxs,
    },
    composerMeta: {
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.xs,
    },
    modelButton: {
        minHeight: 44,
        maxWidth: 180,
        paddingHorizontal: space.xs,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xxs,
    },
    modelLabel: {
        flexShrink: 1,
        color: color.darkInk,
        fontFamily: type.mono,
        fontSize: 11,
    },
    groundingLabel: {
        flexShrink: 1,
        color: color.darkInk2,
        textAlign: "right",
        fontFamily: type.body,
        fontSize: 11,
    },
    askRow: {
        minHeight: 48,
        flexDirection: "row",
        alignItems: "flex-end",
        gap: space.xs,
    },
    input: {
        flex: 1,
        minHeight: 44,
        maxHeight: 120,
        paddingHorizontal: space.xs,
        paddingVertical: space.sm,
        color: color.darkInk,
        fontFamily: type.body,
        fontSize: 16,
    },
    send: {
        width: 44,
        height: 44,
        borderRadius: radius.pill,
        backgroundColor: color.accent,
        alignItems: "center",
        justifyContent: "center",
    },
    disabled: { opacity: 0.45 },
    pressed: { transform: [{ translateY: 1 }] },
    focused: { borderWidth: 2, borderColor: color.focus },
    error: {
        minHeight: 17,
        color: color.coral,
        fontFamily: type.body,
        fontSize: 11,
        paddingHorizontal: space.xs,
    },
    modalBackdrop: {
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: color.overlay,
        padding: space.md,
    },
    modelSheet: {
        maxHeight: "80%",
        padding: space.lg,
        borderRadius: radius.panel,
        backgroundColor: color.paper2,
        gap: space.xs,
    },
    modelHeading: {
        color: color.ink,
        fontFamily: type.bold,
        fontSize: 22,
        marginBottom: space.sm,
    },
});
