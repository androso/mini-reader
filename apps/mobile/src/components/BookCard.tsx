import type { PublicBook } from "@reader/contracts";
import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { useState } from "react";
import { ActionButton } from "./ActionButton";
import type { DownloadRecord } from "@/lib/database";
import { color, radius, space, type } from "@/theme/tokens";

type Props = {
    book: PublicBook;
    download?: DownloadRecord;
    emphasized?: boolean;
    pendingDelete?: boolean;
    onOpen(): void;
    onRetry(): void;
    onDownload(): void;
    onRemoveDownload(): void;
    onDelete(): void;
    style?: ViewStyle;
};

export const BookCard = ({
    book,
    download,
    emphasized = false,
    pendingDelete = false,
    onOpen,
    onRetry,
    onDownload,
    onRemoveDownload,
    onDelete,
    style,
}: Props) => {
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const ready = book.processingStatus === "ready";
    const downloaded = download?.status === "complete";
    return (
        <View
            accessibilityLabel={`${book.title}, ${book.fileType ?? "book"}, ${book.processingStatus}`}
            style={[
                styles.card,
                emphasized && styles.emphasized,
                pendingDelete && styles.pendingDelete,
                style,
            ]}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${book.title}`}
                accessibilityState={{ disabled: !ready }}
                disabled={!ready}
                onPress={onOpen}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onHoverIn={() => setHovered(true)}
                onHoverOut={() => setHovered(false)}
                style={({ pressed }) => [
                    styles.cover,
                    emphasized && styles.coverEmphasized,
                    focused && styles.focused,
                    hovered && styles.hovered,
                    pressed && styles.pressed,
                ]}
            >
                <Text style={styles.coverLetter}>
                    {book.title.trim().slice(0, 1).toUpperCase() || "M"}
                </Text>
                <View style={styles.coverRule} />
                <Text numberOfLines={4} style={styles.coverTitle}>
                    {book.title}
                </Text>
                <Text style={styles.coverType}>
                    {(book.fileType ?? "BOOK").toUpperCase()}
                </Text>
            </Pressable>
            <View style={styles.meta}>
                <Text numberOfLines={2} style={styles.title}>
                    {book.title}
                </Text>
                <View style={styles.statusRow}>
                    <Feather
                        name={
                            ready
                                ? "check-circle"
                                : book.processingStatus === "failed"
                                  ? "alert-circle"
                                  : "clock"
                        }
                        size={14}
                        color={
                            book.processingStatus === "failed"
                                ? color.coral
                                : color.darkInk2
                        }
                    />
                    <Text
                        style={[
                            styles.status,
                            book.processingStatus === "failed" &&
                                styles.statusError,
                        ]}
                    >
                        {ready
                            ? downloaded
                                ? "Available offline"
                                : "Ready"
                            : book.processingStatus === "failed"
                              ? "Processing failed"
                              : "Preparing book"}
                    </Text>
                </View>
                {book.processingStatus === "failed" ? (
                    <ActionButton
                        label="Retry"
                        icon="rotate-ccw"
                        tone="secondary"
                        compact
                        onPress={onRetry}
                    />
                ) : ready ? (
                    <View style={styles.actions}>
                        <ActionButton
                            label={downloaded ? "Remove" : "Download"}
                            icon={downloaded ? "trash-2" : "download"}
                            tone="secondary"
                            compact
                            onPress={downloaded ? onRemoveDownload : onDownload}
                            loading={download?.status === "downloading"}
                        />
                        <ActionButton
                            label="Delete"
                            icon="trash"
                            tone="danger"
                            compact
                            onPress={onDelete}
                        />
                    </View>
                ) : null}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        minWidth: 0,
        gap: space.sm,
        opacity: 1,
    },
    emphasized: {
        flexDirection: "row",
        alignItems: "stretch",
        padding: space.md,
        borderWidth: 1,
        borderColor: color.darkRaised,
        borderRadius: radius.lg,
        backgroundColor: color.darkRaised,
    },
    pendingDelete: { opacity: 0.35 },
    cover: {
        aspectRatio: 0.68,
        minHeight: 180,
        padding: space.md,
        borderWidth: 2,
        borderColor: color.transparent,
        borderRadius: radius.md,
        backgroundColor: color.accent,
        justifyContent: "space-between",
        overflow: "hidden",
    },
    coverEmphasized: { width: 130, minHeight: 190 },
    focused: { borderColor: color.focus },
    hovered: { transform: [{ translateY: -2 }] },
    pressed: { transform: [{ translateY: 1 }] },
    coverLetter: {
        color: color.darkInk,
        fontFamily: type.bold,
        fontSize: 34,
        letterSpacing: -1,
    },
    coverRule: {
        height: 1,
        width: "44%",
        backgroundColor: color.darkInk,
    },
    coverTitle: {
        color: color.darkInk,
        fontFamily: type.bold,
        fontSize: 17,
        lineHeight: 21,
    },
    coverType: {
        color: color.darkInk,
        fontFamily: type.mono,
        fontSize: 10,
        letterSpacing: 1,
    },
    meta: { flex: 1, gap: space.xs },
    title: {
        color: color.darkInk,
        fontFamily: type.semibold,
        fontSize: 16,
        lineHeight: 21,
    },
    statusRow: { flexDirection: "row", gap: space.xs, alignItems: "center" },
    status: {
        flex: 1,
        color: color.darkInk2,
        fontFamily: type.body,
        fontSize: 12,
    },
    statusError: { color: color.coral },
    actions: { gap: space.xs },
});
