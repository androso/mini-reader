import { useMemo, useState } from "react";
import {
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { MessageContextSource } from "@reader/contracts";
import { normalizeAllowedWebUrl } from "@/lib/chatSources";
import { color, radius, space, type } from "@/theme/tokens";

type BookSource = MessageContextSource & {
    sourceType: "book";
    id?: string;
    chunkIndex?: number;
    score?: number;
    bestRank?: number;
};

type WebSource = MessageContextSource & {
    sourceType: "web";
    url: string;
};

const formatScore = (score: number) =>
    Number.isFinite(score) ? score.toFixed(4) : "n/a";

const hostnameOf = (url: string) => {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
};

export const MessageSources = ({
    sources,
}: {
    sources: ReadonlyArray<MessageContextSource>;
}) => {
    const [open, setOpen] = useState(false);
    const allowedUrls = useMemo(() => {
        const urls = new Set<string>();
        for (const source of sources) {
            if (source.sourceType === "web" && typeof source.url === "string") {
                try {
                    urls.add(new URL(source.url).toString());
                } catch {
                    // Ignore malformed source URLs.
                }
            }
        }
        return urls;
    }, [sources]);

    if (sources.length === 0) return null;

    return (
        <View style={styles.root}>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`Sources, ${sources.length}`}
                onPress={() => setOpen((value) => !value)}
                style={({ pressed }) => [
                    styles.summary,
                    pressed && styles.pressed,
                ]}
            >
                <Feather name="book-open" size={14} color={color.accentSoft} />
                <Text style={styles.summaryLabel}>Sources</Text>
                <View style={styles.countChip}>
                    <Text style={styles.countText}>{sources.length}</Text>
                </View>
                <Feather
                    name={open ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={color.darkInk2}
                    style={styles.chevron}
                />
            </Pressable>
            {open && (
                <ScrollView
                    style={styles.body}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                >
                    {sources.map((source, index) => {
                        if (source.sourceType === "web") {
                            const web = source as WebSource;
                            const url = normalizeAllowedWebUrl(
                                web.url,
                                allowedUrls
                            );
                            return (
                                <View
                                    key={`${web.url ?? "web"}-${index}`}
                                    style={[
                                        styles.item,
                                        index === sources.length - 1 &&
                                            styles.itemLast,
                                    ]}
                                >
                                    <Text style={styles.itemTitle}>
                                        {web.title?.trim() ||
                                            hostnameOf(web.url)}
                                    </Text>
                                    {url ? (
                                        <Text
                                            accessibilityRole="link"
                                            style={styles.link}
                                            onPress={() => {
                                                void Linking.openURL(url);
                                            }}
                                        >
                                            {hostnameOf(url)}
                                        </Text>
                                    ) : null}
                                </View>
                            );
                        }

                        const book = source as BookSource;
                        return (
                            <View
                                key={`${book.id ?? "book"}-${index}`}
                                style={[
                                    styles.item,
                                    index === sources.length - 1 &&
                                        styles.itemLast,
                                ]}
                            >
                                <View style={styles.metaRow}>
                                    {typeof book.chunkIndex === "number" && (
                                        <Text style={styles.meta}>
                                            Chunk {book.chunkIndex}
                                        </Text>
                                    )}
                                    {typeof book.score === "number" && (
                                        <Text style={styles.meta}>
                                            Score {formatScore(book.score)}
                                        </Text>
                                    )}
                                    {typeof book.bestRank === "number" && (
                                        <Text style={styles.meta}>
                                            Rank {book.bestRank}
                                        </Text>
                                    )}
                                </View>
                                {book.excerpt ? (
                                    <Text style={styles.excerpt}>
                                        {book.excerpt}
                                    </Text>
                                ) : (
                                    <Text style={styles.excerpt}>
                                        Book passage
                                    </Text>
                                )}
                            </View>
                        );
                    })}
                </ScrollView>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    root: {
        maxWidth: "88%",
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.darkRaised,
        backgroundColor: color.darkRaised,
        overflow: "hidden",
    },
    summary: {
        minHeight: 44,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
    },
    summaryLabel: {
        color: color.darkInk,
        fontFamily: type.semibold,
        fontSize: 12,
    },
    countChip: {
        borderRadius: radius.pill,
        backgroundColor: color.darkPaper,
        paddingHorizontal: space.xs,
        paddingVertical: 2,
    },
    countText: {
        color: color.darkInk2,
        fontFamily: type.mono,
        fontSize: 11,
    },
    chevron: { marginLeft: "auto" },
    body: {
        maxHeight: 280,
        borderTopWidth: 1,
        borderTopColor: color.rule,
        paddingHorizontal: space.sm,
        paddingVertical: space.sm,
        gap: space.sm,
    },
    item: {
        borderBottomWidth: 1,
        borderBottomColor: color.rule,
        paddingBottom: space.sm,
        gap: space.xxs,
    },
    itemLast: {
        borderBottomWidth: 0,
        paddingBottom: 0,
    },
    itemTitle: {
        color: color.darkInk,
        fontFamily: type.body,
        fontSize: 12,
        lineHeight: 18,
    },
    link: {
        color: color.accentSoft,
        fontFamily: type.body,
        fontSize: 12,
        textDecorationLine: "underline",
    },
    metaRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: space.sm,
    },
    meta: {
        color: color.darkInk2,
        fontFamily: type.mono,
        fontSize: 11,
        textTransform: "uppercase",
    },
    excerpt: {
        color: color.darkInk2,
        fontFamily: type.body,
        fontSize: 12,
        lineHeight: 18,
    },
    pressed: { opacity: 0.85 },
});
