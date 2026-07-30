import { useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    RefreshControl,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicBook } from "@reader/contracts";
import { ActionButton } from "@/components/ActionButton";
import { BookCard } from "@/components/BookCard";
import { apiFetch, apiJson } from "@/lib/api";
import { buildBookUploadFormData } from "@/lib/bookUpload";
import { downloadBook, removeDownload } from "@/lib/downloads";
import { listDownloads } from "@/lib/database";
import {
    IOS_PDF_UNAVAILABLE_MESSAGE,
    bookUnavailableReason,
    documentTypesForPlatform,
    isPdfDocument,
} from "@/lib/bookCompatibility";
import { booksQueryKey, useBooks } from "@/hooks/useBooks";
import { color, radius, space, type } from "@/theme/tokens";

type Filter = "all" | "epub" | "pdf";
const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
    { value: "all", label: "All books" },
    { value: "epub", label: "EPUB" },
    { value: "pdf", label: "PDF" },
];

export default function Library() {
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const queryClient = useQueryClient();
    const books = useBooks();
    const downloads = useQuery({
        queryKey: ["downloads"],
        queryFn: listDownloads,
    });
    const [filter, setFilter] = useState<Filter>("all");
    const [notice, setNotice] = useState("");
    const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(
        new Set()
    );
    const deleteTimers = useRef(
        new Map<string, ReturnType<typeof setTimeout>>()
    );

    const upload = useMutation({
        mutationFn: async () => {
            const result = await DocumentPicker.getDocumentAsync({
                type: documentTypesForPlatform(Platform.OS),
                copyToCacheDirectory: true,
                multiple: false,
            });
            if (result.canceled) return;
            const asset = result.assets[0];
            if (
                Platform.OS === "ios" &&
                isPdfDocument(asset.name, asset.mimeType)
            ) {
                throw new Error(IOS_PDF_UNAVAILABLE_MESSAGE);
            }
            const form = await buildBookUploadFormData(asset);
            await apiJson("/api/books", { method: "POST", body: form });
        },
        onSuccess: () => {
            setNotice("Book accepted. Mentarie is preparing it.");
            void queryClient.invalidateQueries({ queryKey: booksQueryKey });
        },
        onError: (error) =>
            setNotice(
                error instanceof Error
                    ? error.message
                    : "The upload couldn’t be completed."
            ),
    });

    const retry = async (book: PublicBook) => {
        await apiJson(`/api/books/${book.id}/retry`, { method: "POST" });
        await queryClient.invalidateQueries({ queryKey: booksQueryKey });
    };

    const startDownload = async (book: PublicBook) => {
        setNotice(`Downloading “${book.title}”…`);
        await downloadBook(book);
        setNotice(`“${book.title}” is available offline.`);
        await queryClient.invalidateQueries({ queryKey: ["downloads"] });
    };

    const scheduleDelete = (book: PublicBook) => {
        setPendingDeletes((current) => new Set(current).add(book.id));
        setNotice(`“${book.title}” will be deleted in 6 seconds.`);
        const timer = setTimeout(() => {
            void apiFetch(`/api/books/${book.id}`, { method: "DELETE" })
                .then(async (response) => {
                    if (!response.ok)
                        throw new Error("The book could not be deleted.");
                    await removeDownload(book.id);
                    await Promise.all([
                        queryClient.invalidateQueries({
                            queryKey: booksQueryKey,
                        }),
                        queryClient.invalidateQueries({
                            queryKey: ["downloads"],
                        }),
                    ]);
                    setNotice(`“${book.title}” was deleted.`);
                })
                .catch((error: Error) => setNotice(error.message))
                .finally(() => {
                    setPendingDeletes((current) => {
                        const next = new Set(current);
                        next.delete(book.id);
                        return next;
                    });
                    deleteTimers.current.delete(book.id);
                });
        }, 6000);
        deleteTimers.current.set(book.id, timer);
    };

    const undoDelete = () => {
        for (const timer of deleteTimers.current.values()) clearTimeout(timer);
        deleteTimers.current.clear();
        setPendingDeletes(new Set());
        setNotice("Deletion cancelled.");
    };

    const visibleBooks = useMemo(
        () =>
            (books.data ?? []).filter(
                (book) => filter === "all" || book.fileType === filter
            ),
        [books.data, filter]
    );
    const recent = visibleBooks[0];
    const rest = recent ? visibleBooks.slice(1) : visibleBooks;
    const cardWidth: `${number}%` =
        width >= 1000 ? "31.8%" : width >= 680 ? "48.5%" : "100%";
    const downloadFor = (bookId: string) =>
        downloads.data?.find((record) => record.book_id === bookId);
    const cardProps = (book: PublicBook) => ({
        book,
        download: downloadFor(book.id),
        pendingDelete: pendingDeletes.has(book.id),
        unavailableReason: bookUnavailableReason(Platform.OS, book.fileType),
        onOpen: () =>
            router.push({
                pathname: "/(app)/reader/[bookId]",
                params: { bookId: book.id },
            }),
        onRetry: () => void retry(book),
        onDownload: () =>
            void startDownload(book).catch((error: Error) =>
                setNotice(error.message)
            ),
        onRemoveDownload: () =>
            void removeDownload(book.id).then(() =>
                queryClient.invalidateQueries({
                    queryKey: ["downloads"],
                })
            ),
        onDelete: () => scheduleDelete(book),
    });
    return (
        <View style={styles.root}>
            <ScrollView
                contentContainerStyle={[
                    styles.content,
                    { paddingTop: insets.top + space.lg },
                ]}
                refreshControl={
                    <RefreshControl
                        refreshing={books.isRefetching}
                        onRefresh={() => void books.refetch()}
                        tintColor={color.accent}
                    />
                }
            >
                <View style={styles.header}>
                    <View style={styles.titleBlock}>
                        <Text style={styles.wordmark}>Mentarie</Text>
                        <Text style={styles.heading}>Your library</Text>
                        <Text style={styles.subheading}>
                            Read closely, then ask from the evidence.
                        </Text>
                    </View>
                    <View style={styles.headerActions}>
                        <ActionButton
                            label="Settings"
                            icon="settings"
                            tone="quiet"
                            compact
                            onPress={() => router.push("/(app)/settings")}
                        />
                        <ActionButton
                            label="Upload book"
                            icon="plus"
                            compact
                            loading={upload.isPending}
                            onPress={() => upload.mutate()}
                        />
                    </View>
                </View>
                <View accessibilityRole="tablist" style={styles.filters}>
                    {FILTERS.map(({ value, label }) => {
                        const selected = filter === value;
                        return (
                            <Pressable
                                key={value}
                                accessibilityRole="tab"
                                accessibilityState={{ selected }}
                                onPress={() => setFilter(value)}
                                style={({ pressed }) => [
                                    styles.filter,
                                    selected && styles.filterSelected,
                                    pressed && styles.filterPressed,
                                ]}
                            >
                                <Text
                                    numberOfLines={1}
                                    style={[
                                        styles.filterText,
                                        selected && styles.filterTextSelected,
                                    ]}
                                >
                                    {label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
                {notice ? (
                    <Text
                        accessibilityLiveRegion="polite"
                        style={styles.notice}
                    >
                        {notice}
                    </Text>
                ) : null}
                {books.isLoading ? (
                    <View
                        accessibilityLabel="Loading your library"
                        accessibilityRole="progressbar"
                        style={styles.skeleton}
                    >
                        <View style={styles.skeletonCover} />
                        <View style={styles.skeletonCopy}>
                            <View style={styles.skeletonTitle} />
                            <View style={styles.skeletonLine} />
                            <View style={styles.skeletonLineShort} />
                        </View>
                    </View>
                ) : visibleBooks.length === 0 ? (
                    <View style={styles.empty}>
                        <Text style={styles.emptyMark}>M</Text>
                        <Text style={styles.emptyTitle}>
                            No books here yet.
                        </Text>
                        <Text style={styles.emptyCopy}>
                            {Platform.OS === "ios"
                                ? "Upload an EPUB to read, save it offline, and ask questions grounded in its text."
                                : "Upload an EPUB or PDF to read, save it offline, and ask questions grounded in its text."}
                        </Text>
                        <ActionButton
                            label="Upload book"
                            icon="upload"
                            onPress={() => upload.mutate()}
                        />
                    </View>
                ) : (
                    <>
                        {recent && (
                            <View style={styles.recent}>
                                <Text style={styles.sectionLabel}>
                                    RECENT READING
                                </Text>
                                <BookCard {...cardProps(recent)} emphasized />
                            </View>
                        )}
                        {rest.length > 0 && (
                            <View style={styles.catalogue}>
                                {rest.map((book) => (
                                    <BookCard
                                        key={book.id}
                                        {...cardProps(book)}
                                        emphasized={width < 680}
                                        style={{ width: cardWidth }}
                                    />
                                ))}
                            </View>
                        )}
                    </>
                )}
            </ScrollView>
            {pendingDeletes.size > 0 && (
                <View
                    style={[
                        styles.undo,
                        { bottom: Math.max(insets.bottom, space.lg) },
                    ]}
                >
                    <Text style={styles.undoText}>
                        Book queued for deletion.
                    </Text>
                    <ActionButton
                        label="Undo"
                        icon="rotate-ccw"
                        tone="secondary"
                        compact
                        onPress={undoDelete}
                    />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: color.darkPaper },
    content: {
        paddingHorizontal: space.md,
        paddingBottom: 120,
        gap: space.lg,
        maxWidth: 1180,
        width: "100%",
        alignSelf: "center",
    },
    header: {
        gap: space.md,
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        flexWrap: "wrap",
    },
    titleBlock: { flex: 1, minWidth: 240, gap: space.xxs },
    wordmark: {
        color: color.accentSoft,
        fontFamily: type.semibold,
        fontSize: 15,
    },
    heading: {
        color: color.darkInk,
        fontFamily: type.bold,
        fontSize: 34,
        letterSpacing: -0.8,
    },
    subheading: {
        maxWidth: 390,
        color: color.darkInk2,
        fontFamily: type.body,
        fontSize: 15,
        lineHeight: 22,
    },
    headerActions: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: space.xs,
    },
    filters: {
        flexDirection: "row",
        gap: space.xs,
        flexWrap: "wrap",
    },
    filter: {
        minHeight: 44,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: color.darkRaised,
        alignItems: "center",
        justifyContent: "center",
    },
    filterSelected: { backgroundColor: color.accent },
    filterPressed: { opacity: 0.78 },
    filterText: {
        color: color.darkInk,
        fontFamily: type.semibold,
        fontSize: 14,
    },
    filterTextSelected: { color: color.darkInk },
    notice: {
        minHeight: 20,
        color: color.darkInk2,
        fontFamily: type.body,
        fontSize: 13,
    },
    skeleton: {
        minHeight: 222,
        padding: space.md,
        borderRadius: radius.lg,
        backgroundColor: color.darkRaised,
        flexDirection: "row",
        gap: space.md,
    },
    skeletonCover: {
        width: 130,
        minHeight: 190,
        borderRadius: radius.md,
        backgroundColor: color.ink2,
        opacity: 0.35,
    },
    skeletonCopy: { flex: 1, paddingTop: space.sm, gap: space.sm },
    skeletonTitle: {
        width: "82%",
        height: 24,
        borderRadius: radius.sm,
        backgroundColor: color.ink2,
        opacity: 0.42,
    },
    skeletonLine: {
        width: "64%",
        height: 14,
        borderRadius: radius.sm,
        backgroundColor: color.ink2,
        opacity: 0.28,
    },
    skeletonLineShort: {
        width: "44%",
        height: 14,
        borderRadius: radius.sm,
        backgroundColor: color.ink2,
        opacity: 0.22,
    },
    empty: {
        alignItems: "flex-start",
        gap: space.md,
        padding: space.xl,
        borderWidth: 1,
        borderColor: color.darkRaised,
        borderRadius: radius.lg,
        backgroundColor: color.darkRaised,
    },
    emptyMark: {
        width: 48,
        height: 48,
        borderRadius: radius.pill,
        backgroundColor: color.accent,
        color: color.darkInk,
        textAlign: "center",
        textAlignVertical: "center",
        fontFamily: type.bold,
        fontSize: 20,
    },
    emptyTitle: {
        color: color.darkInk,
        fontFamily: type.bold,
        fontSize: 24,
    },
    emptyCopy: {
        color: color.darkInk2,
        fontFamily: type.body,
        fontSize: 16,
        lineHeight: 24,
        maxWidth: 580,
    },
    recent: { gap: space.sm },
    sectionLabel: {
        color: color.darkInk2,
        fontFamily: type.mono,
        fontSize: 11,
        letterSpacing: 1.1,
    },
    catalogue: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "flex-start",
        gap: space.md,
    },
    undo: {
        position: "absolute",
        left: space.md,
        right: space.md,
        minHeight: 64,
        padding: space.sm,
        paddingLeft: space.md,
        borderRadius: radius.lg,
        backgroundColor: color.paper2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.sm,
    },
    undoText: {
        flex: 1,
        color: color.ink,
        fontFamily: type.medium,
        fontSize: 14,
    },
});
