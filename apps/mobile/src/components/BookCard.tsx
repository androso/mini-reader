import type { EpubReaderManifest, PublicBook } from "@reader/contracts";
import { Feather } from "@expo/vector-icons";
import {
    ActivityIndicator,
    Image,
    Pressable,
    StyleSheet,
    Text,
    View,
    ViewStyle,
} from "react-native";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActionButton } from "./ActionButton";
import type { DownloadRecord } from "@/lib/database";
import { apiFetch } from "@/lib/api";
import { resourceUri } from "@/lib/downloads";
import { color, radius, space, type } from "@/theme/tokens";

type Props = {
    book: PublicBook;
    download?: DownloadRecord;
    emphasized?: boolean;
    pendingDelete?: boolean;
    unavailableReason?: string | null;
    onOpen(): void;
    onRetry(): void;
    onDownload(): void;
    onRemoveDownload(): void;
    onDelete(): void;
    style?: ViewStyle;
};
type CoverManifestState =
    | { status: "processing" | "unavailable" }
    | { status: "ready"; manifest: EpubReaderManifest };

export const BookCard = ({
    book,
    download,
    emphasized = false,
    pendingDelete = false,
    unavailableReason = null,
    onOpen,
    onRetry,
    onDownload,
    onRemoveDownload,
    onDelete,
    style,
}: Props) => {
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [coverUri, setCoverUri] = useState<string | null>(null);
    const [coverFailed, setCoverFailed] = useState(false);
    const ready = book.processingStatus === "ready";
    const downloaded = download?.status === "complete";
    const unavailable = Boolean(unavailableReason);
    const openDisabled = unavailable || !ready;
    const coverManifest = useQuery({
        queryKey: ["book-cover-manifest", book.id],
        queryFn: async (): Promise<CoverManifestState> => {
            const response = await apiFetch(
                `/api/books/${book.id}/reader-manifest`
            );
            if (response.status === 202) return { status: "processing" };
            if (response.status === 409) return { status: "unavailable" };
            if (!response.ok) {
                throw new Error("The book cover could not be loaded.");
            }
            return {
                status: "ready",
                manifest: (await response.json()) as EpubReaderManifest,
            };
        },
        enabled: ready && book.fileType === "epub",
        retry: false,
        refetchInterval: (query) =>
            query.state.data?.status === "processing" ? 3000 : false,
    });
    const coverResourceId =
        coverManifest.data?.status === "ready"
            ? coverManifest.data.manifest.coverResourceId
            : null;

    useEffect(() => {
        let cancelled = false;
        setCoverUri(null);
        setCoverFailed(false);
        if (!coverResourceId) return;
        void resourceUri(book.id, coverResourceId)
            .then((uri) => {
                if (!cancelled) setCoverUri(uri);
            })
            .catch(() => {
                if (!cancelled) setCoverFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [book.id, coverResourceId]);

    const showFallback = !coverUri || coverFailed;
    const coverLoading =
        ready &&
        book.fileType === "epub" &&
        (coverManifest.isPending || Boolean(coverResourceId && !coverUri));
    const statusLabel = unavailable
        ? unavailableReason!
        : download?.status === "downloading"
          ? "Downloading for offline use…"
          : ready
            ? downloaded
                ? "Available offline"
                : "Ready to read"
            : book.processingStatus === "failed"
              ? "Processing failed"
              : "Preparing book";
    return (
        <View
            accessibilityLabel={`${book.title}, ${book.fileType ?? "book"}, ${unavailable ? unavailableReason : book.processingStatus}`}
            style={[
                styles.card,
                emphasized && styles.emphasized,
                pendingDelete && styles.pendingDelete,
                style,
            ]}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                    unavailable
                        ? `${book.title}. ${unavailableReason}`
                        : `Open ${book.title}`
                }
                accessibilityState={{ disabled: openDisabled }}
                disabled={openDisabled}
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
                {!showFallback ? (
                    <Image
                        accessibilityLabel={`${book.title} cover`}
                        onError={() => setCoverFailed(true)}
                        resizeMode="cover"
                        source={{ uri: coverUri }}
                        style={styles.coverImage}
                    />
                ) : (
                    <>
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
                    </>
                )}
                {coverLoading ? (
                    <View style={styles.coverLoading}>
                        <ActivityIndicator color={color.darkInk} size="small" />
                    </View>
                ) : null}
            </Pressable>
            <View style={styles.meta}>
                <Text numberOfLines={2} style={styles.title}>
                    {book.title}
                </Text>
                <View style={styles.statusRow}>
                    <Feather
                        name={
                            unavailable
                                ? "alert-circle"
                                : ready
                                  ? "check-circle"
                                  : book.processingStatus === "failed"
                                    ? "alert-circle"
                                    : "clock"
                        }
                        size={14}
                        color={
                            unavailable || book.processingStatus === "failed"
                                ? color.coral
                                : color.darkInk2
                        }
                    />
                    <Text
                        style={[
                            styles.status,
                            (unavailable ||
                                book.processingStatus === "failed") &&
                                styles.statusError,
                        ]}
                    >
                        {statusLabel}
                    </Text>
                </View>
                {unavailable ? (
                    <View style={styles.actions}>
                        {download ? (
                            <ActionButton
                                label="Remove"
                                icon="trash-2"
                                tone="quiet"
                                compact
                                onPress={onRemoveDownload}
                            />
                        ) : null}
                        <ActionButton
                            label="Delete"
                            icon="trash"
                            tone="danger"
                            compact
                            onPress={onDelete}
                        />
                    </View>
                ) : book.processingStatus === "failed" ? (
                    <ActionButton
                        label="Retry"
                        icon="rotate-ccw"
                        tone="quiet"
                        compact
                        onPress={onRetry}
                    />
                ) : ready ? (
                    <View style={styles.actions}>
                        <ActionButton
                            label="Read & ask"
                            icon="message-circle"
                            compact
                            onPress={onOpen}
                        />
                        <View style={styles.utilityActions}>
                            <ActionButton
                                label={downloaded ? "Remove" : "Save"}
                                icon={downloaded ? "trash-2" : "download"}
                                tone="quiet"
                                compact
                                style={styles.utilityButton}
                                onPress={
                                    downloaded ? onRemoveDownload : onDownload
                                }
                                loading={download?.status === "downloading"}
                                accessibilityHint={
                                    downloaded
                                        ? "Remove the offline copy"
                                        : "Make this book available offline"
                                }
                            />
                            <ActionButton
                                label="Delete"
                                icon="trash"
                                tone="danger"
                                compact
                                style={styles.utilityButton}
                                onPress={onDelete}
                            />
                        </View>
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
    coverImage: {
        ...StyleSheet.absoluteFill,
        width: undefined,
        height: undefined,
    },
    coverLoading: {
        ...StyleSheet.absoluteFill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color.paper2,
    },
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
    utilityActions: { flexDirection: "row", gap: space.xs },
    utilityButton: { flex: 1, minWidth: 0 },
});
