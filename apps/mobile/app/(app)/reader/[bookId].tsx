import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useNetInfo } from "@react-native-community/netinfo";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
    EpubReaderChapter,
    EpubReaderManifest,
    HighlightContext,
    ProgressRecord,
} from "@reader/contracts";
import { ActionButton } from "@/components/ActionButton";
import { EpubChapterView } from "@/components/EpubChapterView";
import { PdfBookView } from "@/components/PdfBookView";
import { ReaderChat } from "@/components/ReaderChat";
import { apiFetch, apiJson } from "@/lib/api";
import {
    offlinePdfUri,
    readOfflineChapter,
    readOfflineManifest,
} from "@/lib/downloads";
import { getLocalProgress, saveLocalProgress } from "@/lib/database";
import { useBooks } from "@/hooks/useBooks";
import { useReadingTheme } from "@/providers/ReadingThemeProvider";
import { color, radius, space, type } from "@/theme/tokens";

type ManifestState =
    | { status: "processing" }
    | { status: "failed"; error: string }
    | { status: "ready"; manifest: EpubReaderManifest };

const chapterKey = (bookId: string, chapterId: string) => [
    "reader-chapter",
    bookId,
    chapterId,
];

const loadManifest = async (
    bookId: string,
    online: boolean
): Promise<ManifestState> => {
    const offline = await readOfflineManifest(bookId);
    if (!online && offline) return { status: "ready", manifest: offline };
    if (!online) {
        return {
            status: "failed",
            error: "This EPUB has not been downloaded for offline reading.",
        };
    }
    const response = await apiFetch(`/api/books/${bookId}/reader-manifest`);
    if (response.status === 202) return { status: "processing" };
    if (response.status === 409) {
        const payload = (await response.json()) as { error?: string };
        return {
            status: "failed",
            error: payload.error ?? "Reader package generation failed.",
        };
    }
    if (!response.ok) {
        throw new Error("The EPUB reader package could not be loaded.");
    }
    return {
        status: "ready",
        manifest: (await response.json()) as EpubReaderManifest,
    };
};

const loadChapter = async (
    bookId: string,
    chapterId: string,
    online: boolean
) => {
    const offline = await readOfflineChapter(bookId, chapterId);
    if (!online && offline) return offline;
    if (!online) throw new Error("This chapter is not available offline.");
    return apiJson<EpubReaderChapter>(
        `/api/books/${bookId}/reader-chapters/${encodeURIComponent(chapterId)}`
    );
};

export default function Reader() {
    const { bookId } = useLocalSearchParams<{ bookId: string }>();
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const isTablet = width >= 768;
    const network = useNetInfo();
    const online = network.isConnected !== false;
    const queryClient = useQueryClient();
    const { isDark } = useReadingTheme();
    const books = useBooks();
    const book = books.data?.find((candidate) => candidate.id === bookId);
    const [highlight, setHighlight] = useState<HighlightContext | null>(null);
    const [tocOpen, setTocOpen] = useState(false);
    const [chapterIndex, setChapterIndex] = useState(0);
    const [restoreBlock, setRestoreBlock] = useState<string | null>(null);
    const [pdfUri, setPdfUri] = useState<string | null>(null);
    const [initialPdfPage, setInitialPdfPage] = useState(1);

    const progress = useQuery({
        queryKey: ["progress", bookId],
        queryFn: async () => {
            const local = await getLocalProgress(bookId);
            if (local) {
                return {
                    bookId,
                    progressPosition: local.progress_position,
                    progressChapter: local.progress_chapter,
                } satisfies ProgressRecord;
            }
            if (!online)
                return {
                    bookId,
                    progressPosition: null,
                    progressChapter: null,
                };
            return {
                bookId,
                ...(await apiJson<Omit<ProgressRecord, "bookId">>(
                    `/api/${bookId}/progress`
                )),
            };
        },
    });

    const manifest = useQuery({
        queryKey: ["reader-manifest", bookId, online],
        queryFn: () => loadManifest(bookId, online),
        enabled: book?.fileType === "epub",
        refetchInterval: (query) =>
            query.state.data?.status === "processing" ? 2000 : false,
    });
    const readyManifest =
        manifest.data?.status === "ready" ? manifest.data.manifest : null;

    useEffect(() => {
        if (!readyManifest || !progress.data) return;
        const targetIndex = readyManifest.chapters.findIndex(
            (chapter) => chapter.id === progress.data?.progressChapter
        );
        if (targetIndex >= 0) setChapterIndex(targetIndex);
        setRestoreBlock(progress.data.progressPosition);
    }, [progress.data, readyManifest]);
    useEffect(() => {
        if (book?.fileType !== "pdf") return;
        void offlinePdfUri(bookId).then(setPdfUri);
        const page = Number(progress.data?.progressPosition ?? "1");
        if (Number.isInteger(page) && page > 0) setInitialPdfPage(page);
    }, [book?.fileType, bookId, progress.data?.progressPosition]);

    const currentSummary = readyManifest?.chapters[chapterIndex];
    const chapter = useQuery({
        queryKey: currentSummary
            ? chapterKey(bookId, currentSummary.id)
            : ["reader-chapter", bookId, "none"],
        queryFn: () => loadChapter(bookId, currentSummary!.id, online),
        enabled: Boolean(currentSummary),
    });

    useEffect(() => {
        if (!readyManifest || !currentSummary) return;
        for (const index of [chapterIndex - 1, chapterIndex + 1]) {
            const adjacent = readyManifest.chapters[index];
            if (!adjacent) continue;
            void queryClient.prefetchQuery({
                queryKey: chapterKey(bookId, adjacent.id),
                queryFn: () => loadChapter(bookId, adjacent.id, online),
            });
        }
    }, [
        bookId,
        chapterIndex,
        currentSummary,
        online,
        queryClient,
        readyManifest,
    ]);

    const navigateChapter = async (direction: "previous" | "next") => {
        if (!readyManifest) return;
        const nextIndex = chapterIndex + (direction === "next" ? 1 : -1);
        const next = readyManifest.chapters[nextIndex];
        if (!next) return;
        await queryClient.fetchQuery({
            queryKey: chapterKey(bookId, next.id),
            queryFn: () => loadChapter(bookId, next.id, online),
        });
        setRestoreBlock(next.firstBlockId);
        setChapterIndex(nextIndex);
    };

    const persistProgress = (position: string, chapterId: string) => {
        void saveLocalProgress(bookId, position, chapterId);
    };

    const readerContent = useMemo(() => {
        if (!book || books.isLoading) {
            return (
                <View style={styles.center}>
                    <ActivityIndicator color={color.accent} />
                </View>
            );
        }
        if (book.fileType === "pdf") {
            return (
                <PdfBookView
                    bookId={bookId}
                    offlineUri={pdfUri}
                    initialPage={initialPdfPage}
                    onPage={(page) => persistProgress(String(page), "pdf")}
                />
            );
        }
        if (manifest.data?.status === "processing") {
            return (
                <View style={styles.center}>
                    <ActivityIndicator color={color.accent} />
                    <Text style={styles.centerTitle}>
                        Preparing the native reader…
                    </Text>
                    <Text style={styles.centerCopy}>
                        The sanitized chapters are being generated once, then
                        they can be downloaded for offline reading.
                    </Text>
                </View>
            );
        }
        if (manifest.data?.status === "failed") {
            return (
                <View style={styles.center}>
                    <Feather
                        name="alert-circle"
                        size={28}
                        color={color.coral}
                    />
                    <Text style={styles.centerTitle}>
                        The EPUB reader isn’t ready.
                    </Text>
                    <Text style={styles.centerCopy}>{manifest.data.error}</Text>
                    {online && (
                        <ActionButton
                            label="Retry reader package"
                            icon="rotate-ccw"
                            onPress={() =>
                                void apiJson(
                                    `/api/books/${bookId}/reader-package/retry`,
                                    { method: "POST" }
                                ).then(() => manifest.refetch())
                            }
                        />
                    )}
                </View>
            );
        }
        if (!chapter.data) {
            return (
                <View style={styles.center}>
                    <ActivityIndicator color={color.accent} />
                </View>
            );
        }
        return (
            <EpubChapterView
                bookId={bookId}
                chapter={chapter.data}
                isDark={isDark}
                restoreBlockId={restoreBlock}
                swipeActionsEnabled={!isTablet}
                onVisibleBlock={(blockId) => {
                    setRestoreBlock(blockId);
                    persistProgress(blockId, chapter.data.id);
                }}
                onSelection={setHighlight}
                onNavigate={(direction) => void navigateChapter(direction)}
            />
        );
    }, [
        book,
        bookId,
        books.isLoading,
        chapter.data,
        initialPdfPage,
        isDark,
        isTablet,
        manifest,
        online,
        pdfUri,
        restoreBlock,
    ]);

    return (
        <View style={styles.root}>
            <View style={[styles.readerPane, isTablet && styles.readerTablet]}>
                <View
                    style={[
                        styles.header,
                        {
                            paddingTop: insets.top,
                            minHeight: 64 + insets.top,
                        },
                    ]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Back to library"
                        onPress={() => router.replace("/(app)/library")}
                        style={({ pressed }) => [
                            styles.iconButton,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Feather
                            name="arrow-left"
                            size={20}
                            color={color.darkInk}
                        />
                    </Pressable>
                    <View style={styles.bookHeading}>
                        <Text numberOfLines={1} style={styles.bookTitle}>
                            {book?.title ?? "Reader"}
                        </Text>
                        {currentSummary && (
                            <Text numberOfLines={1} style={styles.chapterTitle}>
                                {currentSummary.title ??
                                    `Chapter ${chapterIndex + 1}`}
                            </Text>
                        )}
                    </View>
                    {readyManifest && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Table of contents"
                            onPress={() => setTocOpen((value) => !value)}
                            style={({ pressed }) => [
                                styles.iconButton,
                                pressed && styles.pressed,
                            ]}
                        >
                            <Feather
                                name="list"
                                size={20}
                                color={color.darkInk}
                            />
                        </Pressable>
                    )}
                </View>
                <View style={styles.viewer}>{readerContent}</View>
                {tocOpen && readyManifest && (
                    <View
                        style={[
                            styles.toc,
                            { top: 64 + insets.top + space.xs },
                        ]}
                    >
                        <View style={styles.tocHeader}>
                            <Text style={styles.tocTitle}>
                                Table of contents
                            </Text>
                            <ActionButton
                                label="Close"
                                icon="x"
                                tone="secondary"
                                compact
                                onPress={() => setTocOpen(false)}
                            />
                        </View>
                        <ScrollView>
                            {readyManifest.chapters.map((item, index) => (
                                <Pressable
                                    key={item.id}
                                    accessibilityRole="button"
                                    onPress={() => {
                                        setChapterIndex(index);
                                        setRestoreBlock(item.firstBlockId);
                                        setTocOpen(false);
                                    }}
                                    style={({ pressed }) => [
                                        styles.tocItem,
                                        index === chapterIndex &&
                                            styles.tocItemActive,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Text
                                        numberOfLines={2}
                                        style={styles.tocItemText}
                                    >
                                        {item.title ?? `Chapter ${index + 1}`}
                                    </Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                    </View>
                )}
                {!isTablet && (
                    <ReaderChat
                        bookId={bookId}
                        isTablet={false}
                        highlightContext={highlight}
                        onClearHighlight={() => setHighlight(null)}
                    />
                )}
            </View>
            {isTablet && (
                <ReaderChat
                    bookId={bookId}
                    isTablet
                    highlightContext={highlight}
                    onClearHighlight={() => setHighlight(null)}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        flexDirection: "row",
        backgroundColor: color.darkPaper,
    },
    readerPane: { flex: 1, minWidth: 0, position: "relative" },
    readerTablet: { flexBasis: "58%", flexGrow: 1.35 },
    header: {
        minHeight: 64,
        paddingHorizontal: space.sm,
        borderBottomWidth: 1,
        borderBottomColor: color.darkRaised,
        backgroundColor: color.darkPaper,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
    },
    iconButton: {
        width: 44,
        height: 44,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
    },
    pressed: { transform: [{ translateY: 1 }] },
    focused: { borderWidth: 2, borderColor: color.focus },
    bookHeading: { flex: 1, minWidth: 0, alignItems: "center" },
    bookTitle: {
        color: color.darkInk,
        fontFamily: type.semibold,
        fontSize: 14,
    },
    chapterTitle: {
        color: color.darkInk2,
        fontFamily: type.body,
        fontSize: 11,
    },
    viewer: { flex: 1, minHeight: 0 },
    center: {
        flex: 1,
        padding: space.xl,
        alignItems: "center",
        justifyContent: "center",
        gap: space.md,
        backgroundColor: color.darkPaper,
    },
    centerTitle: {
        color: color.darkInk,
        textAlign: "center",
        fontFamily: type.bold,
        fontSize: 22,
    },
    centerCopy: {
        maxWidth: 520,
        color: color.darkInk2,
        textAlign: "center",
        fontFamily: type.body,
        fontSize: 15,
        lineHeight: 23,
    },
    toc: {
        position: "absolute",
        top: 72,
        right: space.sm,
        bottom: space.sm,
        width: "82%",
        maxWidth: 420,
        borderWidth: 1,
        borderColor: color.rule,
        borderRadius: radius.lg,
        backgroundColor: color.paper2,
        overflow: "hidden",
        zIndex: 30,
    },
    tocHeader: {
        padding: space.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        borderBottomWidth: 1,
        borderBottomColor: color.rule,
    },
    tocTitle: {
        flex: 1,
        color: color.ink,
        fontFamily: type.semibold,
        fontSize: 17,
    },
    tocItem: {
        minHeight: 52,
        padding: space.sm,
        justifyContent: "center",
        borderBottomWidth: 1,
        borderBottomColor: color.rule,
    },
    tocItemActive: { backgroundColor: color.accentSoft },
    tocItemText: {
        color: color.ink,
        fontFamily: type.body,
        fontSize: 14,
    },
});
