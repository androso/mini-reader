import { useEffect, useMemo, useState } from "react";
import { Keyboard, Linking, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { EpubReaderChapter, HighlightContext } from "@reader/contracts";
import { resourceUri } from "@/lib/downloads";
import { color } from "@/theme/tokens";

export type ReaderBridgeMessage =
    | { type: "visible-block"; blockId: string }
    | {
          type: "selection";
          text: string;
          blockId: string;
          chapterId: string;
      }
    | { type: "pull-state"; edge: "top" | "bottom"; state: "pull" | "release" }
    | { type: "navigate"; direction: "previous" | "next" }
    | { type: "tap" };

const escapeScript = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const bridgeScript = (chapterId: string) => `
(() => {
  const send = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
  const blocks = [...document.querySelectorAll('[data-block-id]')];
  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) send({ type: 'visible-block', blockId: visible.target.dataset.blockId });
  }, { threshold: [0.25, 0.6] });
  blocks.forEach((block) => observer.observe(block));

  let selectionTimer;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || '';
      if (!text) return;
      const node = selection.anchorNode?.nodeType === 1
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
      const block = node?.closest?.('[data-block-id]');
      send({
        type: 'selection',
        text: text.slice(0, 4000),
        blockId: block?.dataset.blockId || '',
        chapterId: '${escapeScript(chapterId)}'
      });
    }, 180);
  });

  let startY = 0;
  let edge = null;
  let released = false;
  document.addEventListener('touchstart', (event) => {
    send({ type: 'tap' });
    startY = event.touches[0]?.clientY || 0;
    edge = window.scrollY <= 0 ? 'top' :
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1 ? 'bottom' : null;
    released = false;
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    if (!edge) return;
    const delta = (event.touches[0]?.clientY || 0) - startY;
    const distance = edge === 'top' ? delta : -delta;
    const nextReleased = distance >= 72;
    if (distance > 10) {
      document.body.dataset.pullEdge = edge;
      document.body.dataset.pullState = nextReleased ? 'release' : 'pull';
      send({ type: 'pull-state', edge, state: nextReleased ? 'release' : 'pull' });
    }
    released = nextReleased;
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (edge && released) {
      send({ type: 'navigate', direction: edge === 'top' ? 'previous' : 'next' });
    }
    delete document.body.dataset.pullEdge;
    delete document.body.dataset.pullState;
    edge = null;
    released = false;
  }, { passive: true });
})();
true;
`;

const createDocument = (
    chapter: EpubReaderChapter,
    blocks: string[],
    isDark: boolean
) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    :root { color-scheme: ${isDark ? "dark" : "light"}; }
    html, body { overflow-x: clip; }
    body {
      margin: 0;
      padding: 56px max(22px, env(safe-area-inset-left)) 120px;
      background: ${isDark ? color.darkPaper : color.paper};
      color: ${isDark ? color.darkInk : color.ink};
      font-family: Literata, Georgia, serif;
      font-size: 18px;
      line-height: 1.72;
      overflow-wrap: anywhere;
    }
    main { max-width: 68ch; margin: 0 auto; min-width: 0; }
    [data-block-id] { margin-block: 0 1.1em; min-width: 0; }
    h1, h2, h3, h4 { font-family: "Plus Jakarta Sans", sans-serif; font-style: normal; line-height: 1.18; letter-spacing: -0.025em; }
    h1 { font-size: 2rem; } h2 { font-size: 1.55rem; } h3 { font-size: 1.3rem; }
    img { display: block; width: auto; max-width: 100%; height: auto; margin: 1.5em auto; }
    a { color: ${isDark ? color.accentSoft : color.link}; text-decoration-thickness: 1px; text-underline-offset: 3px; }
    blockquote { margin-inline: 0; padding-inline-start: 1em; border-inline-start: 3px solid ${color.accent}; }
    pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
    table { display: block; max-width: 100%; overflow-x: auto; }
    ::selection { background: ${color.accentSoft}; color: ${color.ink}; }
    body::before, body::after {
      position: fixed; left: 50%; z-index: 4; transform: translateX(-50%);
      padding: 8px 14px; border-radius: 999px; background: ${color.darkRaised};
      color: ${color.darkInk}; font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px; opacity: 0; pointer-events: none;
    }
    body::before { content: "Pull for previous chapter"; top: 12px; }
    body::after { content: "Pull for next chapter"; bottom: 12px; }
    body[data-pull-edge="top"]::before, body[data-pull-edge="bottom"]::after { opacity: 1; }
    body[data-pull-state="release"][data-pull-edge="top"]::before { content: "Release for previous chapter"; }
    body[data-pull-state="release"][data-pull-edge="bottom"]::after { content: "Release for next chapter"; }
  </style>
</head>
<body>
  <main>${blocks.join("")}</main>
  <script>${bridgeScript(chapter.id)}</script>
</body>
</html>`;

export const EpubChapterView = ({
    bookId,
    chapter,
    isDark,
    restoreBlockId,
    onVisibleBlock,
    onSelection,
    onNavigate,
}: {
    bookId: string;
    chapter: EpubReaderChapter;
    isDark: boolean;
    restoreBlockId?: string | null;
    onVisibleBlock(blockId: string): void;
    onSelection(context: HighlightContext): void;
    onNavigate(direction: "previous" | "next"): void;
}) => {
    const [html, setHtml] = useState<string | null>(null);
    const resourceIds = useMemo(
        () =>
            Array.from(
                new Set(
                    chapter.blocks.flatMap((block) =>
                        Array.from(
                            block.html.matchAll(
                                /data-reader-resource-id="([a-f0-9]{32})"/g
                            ),
                            (match) => match[1]
                        )
                    )
                )
            ),
        [chapter.blocks]
    );
    useEffect(() => {
        let cancelled = false;
        void Promise.all(
            resourceIds.map(async (id) => [id, await resourceUri(bookId, id)])
        ).then((entries) => {
            if (cancelled) return;
            const uriById = new Map<string, string>(
                entries as Array<[string, string]>
            );
            const blocks = chapter.blocks.map((block) => {
                let content = block.html;
                for (const [id, uri] of uriById) {
                    content = content.replace(
                        new RegExp(`data-reader-resource-id="${id}"`, "g"),
                        `src="${uri}" data-reader-resource-id="${id}"`
                    );
                }
                return `<section data-block-id="${block.id}" id="${block.id}">${content}</section>`;
            });
            setHtml(createDocument(chapter, blocks, isDark));
        });
        return () => {
            cancelled = true;
        };
    }, [bookId, chapter, isDark, resourceIds]);

    const handleMessage = (event: WebViewMessageEvent) => {
        try {
            const message = JSON.parse(
                event.nativeEvent.data
            ) as ReaderBridgeMessage;
            if (message.type === "visible-block") {
                onVisibleBlock(message.blockId);
            } else if (message.type === "selection" && message.text) {
                onSelection({
                    sourceType: "epub",
                    text: message.text,
                    chapterId: message.chapterId,
                    blockId: message.blockId,
                });
            } else if (message.type === "navigate") {
                onNavigate(message.direction);
            } else if (message.type === "tap") {
                Keyboard.dismiss();
            }
        } catch {
            // Ignore messages that do not conform to the app-controlled bridge.
        }
    };
    if (!html) return <View style={styles.loading} />;
    return (
        <WebView
            source={{ html }}
            style={styles.webview}
            originWhitelist={["about:blank", "file://*"]}
            allowFileAccess
            allowingReadAccessToURL="file://"
            javaScriptEnabled
            domStorageEnabled={false}
            setSupportMultipleWindows={false}
            onMessage={handleMessage}
            onShouldStartLoadWithRequest={(request) => {
                if (
                    request.url === "about:blank" ||
                    request.url.startsWith("file://")
                ) {
                    return true;
                }
                if (/^https?:/i.test(request.url)) {
                    void Linking.openURL(request.url);
                }
                return false;
            }}
            onLoadEnd={(event) => {
                if (!restoreBlockId) return;
                event.nativeEvent;
            }}
            injectedJavaScript={
                restoreBlockId
                    ? `document.getElementById(${JSON.stringify(
                          restoreBlockId
                      )})?.scrollIntoView({block:'start'}); true;`
                    : "true;"
            }
        />
    );
};

const styles = StyleSheet.create({
    loading: { flex: 1, backgroundColor: color.darkPaper },
    webview: { flex: 1, backgroundColor: color.transparent },
});
