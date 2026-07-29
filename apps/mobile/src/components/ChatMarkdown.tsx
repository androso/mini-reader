import type { ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import {
    parseMarkdownBlocks,
    type BlockNode,
    type InlineNode,
} from "@/lib/chatMarkdown";
import { normalizeAllowedWebUrl } from "@/lib/chatSources";
import { color, radius, space, type } from "@/theme/tokens";

const renderInline = (
    nodes: InlineNode[],
    allowedUrls: ReadonlySet<string>,
    keyPrefix = "i"
): ReactNode[] =>
    nodes.map((node, index) => {
        const key = `${keyPrefix}-${index}`;
        if (node.type === "text") {
            return <Text key={key}>{node.value}</Text>;
        }
        if (node.type === "code") {
            return (
                <Text key={key} style={styles.inlineCode}>
                    {node.value}
                </Text>
            );
        }
        if (node.type === "strong") {
            return (
                <Text key={key} style={styles.strong}>
                    {renderInline(node.children, allowedUrls, key)}
                </Text>
            );
        }
        if (node.type === "em") {
            return (
                <Text key={key} style={styles.em}>
                    {renderInline(node.children, allowedUrls, key)}
                </Text>
            );
        }
        const safeUrl = normalizeAllowedWebUrl(node.href, allowedUrls);
        if (!safeUrl) {
            return (
                <Text key={key}>
                    {renderInline(node.children, allowedUrls, key)}
                </Text>
            );
        }
        return (
            <Text
                key={key}
                accessibilityRole="link"
                style={styles.link}
                onPress={() => {
                    void Linking.openURL(safeUrl);
                }}
            >
                {renderInline(node.children, allowedUrls, key)}
            </Text>
        );
    });

const Blocks = ({
    blocks,
    allowedUrls,
}: {
    blocks: BlockNode[];
    allowedUrls: ReadonlySet<string>;
}) => (
    <View style={styles.root}>
        {blocks.map((block, index) => {
            if (block.type === "paragraph") {
                return (
                    <Text key={index} selectable style={styles.text}>
                        {renderInline(block.children, allowedUrls, `p${index}`)}
                    </Text>
                );
            }
            if (block.type === "heading") {
                return (
                    <Text
                        key={index}
                        selectable
                        style={[styles.text, styles.heading]}
                    >
                        {renderInline(block.children, allowedUrls, `h${index}`)}
                    </Text>
                );
            }
            if (block.type === "code") {
                return (
                    <View key={index} style={styles.codeBlock}>
                        <Text selectable style={styles.codeText}>
                            {block.value}
                        </Text>
                    </View>
                );
            }
            if (block.type === "blockquote") {
                return (
                    <View key={index} style={styles.blockquote}>
                        <Blocks
                            blocks={block.children}
                            allowedUrls={allowedUrls}
                        />
                    </View>
                );
            }
            return (
                <View key={index} style={styles.list}>
                    {block.items.map((item, itemIndex) => (
                        <View key={itemIndex} style={styles.listItem}>
                            <Text style={styles.listMarker}>
                                {block.ordered ? `${itemIndex + 1}.` : "•"}
                            </Text>
                            <Text
                                selectable
                                style={[styles.text, styles.listBody]}
                            >
                                {renderInline(
                                    item,
                                    allowedUrls,
                                    `l${index}-${itemIndex}`
                                )}
                            </Text>
                        </View>
                    ))}
                </View>
            );
        })}
    </View>
);

export const ChatMarkdown = ({
    content,
    allowedUrls,
}: {
    content: string;
    allowedUrls: ReadonlySet<string>;
}) => {
    const blocks = parseMarkdownBlocks(content);
    if (blocks.length === 0) {
        return (
            <Text selectable style={styles.text}>
                {content}
            </Text>
        );
    }
    return <Blocks blocks={blocks} allowedUrls={allowedUrls} />;
};

export const allowedUrlsFromSources = (
    sources:
        | ReadonlyArray<{ sourceType?: string; url?: string | null }>
        | null
        | undefined
) => {
    const urls = new Set<string>();
    for (const source of sources ?? []) {
        if (source.sourceType === "web" && typeof source.url === "string") {
            try {
                urls.add(new URL(source.url).toString());
            } catch {
                // Ignore malformed source URLs.
            }
        }
    }
    return urls;
};

const styles = StyleSheet.create({
    root: { gap: space.xs },
    text: {
        color: color.darkInk,
        fontFamily: type.body,
        fontSize: 15,
        lineHeight: 23,
    },
    heading: {
        fontFamily: type.semibold,
        lineHeight: 21,
    },
    strong: { fontFamily: type.semibold },
    em: { fontStyle: "italic" },
    link: {
        color: color.accentSoft,
        textDecorationLine: "underline",
    },
    inlineCode: {
        fontFamily: type.mono,
        fontSize: 13,
        backgroundColor: color.darkPaper,
        color: color.darkInk,
    },
    codeBlock: {
        borderRadius: radius.sm,
        backgroundColor: color.darkPaper,
        padding: space.sm,
    },
    codeText: {
        color: color.darkInk,
        fontFamily: type.mono,
        fontSize: 13,
        lineHeight: 20,
    },
    blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: color.rule,
        paddingLeft: space.sm,
        gap: space.xs,
    },
    list: { gap: space.xxs },
    listItem: { flexDirection: "row", gap: space.xs, alignItems: "flex-start" },
    listMarker: {
        color: color.darkInk2,
        fontFamily: type.body,
        fontSize: 15,
        lineHeight: 23,
        minWidth: 16,
    },
    listBody: { flex: 1 },
});
