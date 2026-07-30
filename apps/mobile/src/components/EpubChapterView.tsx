import { useEffect, useMemo, useState } from "react";
import { Keyboard, Linking, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { EpubReaderChapter, HighlightContext } from "@reader/contracts";
import { resourceUri } from "@/lib/downloads";
import {
    readerHighlightContextFromMessage,
    type ReaderBridgeMessage,
} from "@/lib/readerBridge";
import { color } from "@/theme/tokens";

const escapeScript = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const bridgeScript = (chapterId: string, swipeActionsEnabled: boolean) => `
(() => {
  const EDGE_GUARD = 24;
  const INTENT_DISTANCE = 16;
  const HORIZONTAL_RATIO = 2;
  const REVEAL_DISTANCE = 84;
  const OPEN_THRESHOLD = 48;
  const CLOSE_THRESHOLD = 36;
  const SNAP_DURATION_MS = 180;
  const REDUCED_MOTION_MS = 16;
  const SNAP_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const CHAPTER_ID = '${escapeScript(chapterId)}';
  const SWIPE_ENABLED = ${swipeActionsEnabled ? "true" : "false"};

  const send = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
  const blocks = [...document.querySelectorAll('[data-block-id]')];
  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) send({ type: 'visible-block', blockId: visible.target.dataset.blockId });
  }, { threshold: [0.25, 0.6] });
  blocks.forEach((block) => observer.observe(block));

  const snapDuration = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? REDUCED_MOTION_MS
      : SNAP_DURATION_MS;

  const normalizeText = (value) => (value || '').replace(/\\s+/g, ' ').trim();

  let openSection = null;

  const contentEl = (section) => section?.querySelector?.(':scope > .reader-swipe-content');

  const setRailOpen = (section, open, animate) => {
    if (!section) return;
    const content = contentEl(section);
    if (!content) return;
    const offset = open ? REVEAL_DISTANCE : 0;
    content.style.transition = animate
      ? 'transform ' + snapDuration() + 'ms ' + SNAP_EASING
      : 'none';
    content.style.transform = 'translateX(' + offset + 'px)';
    section.classList.toggle('is-open', open);
    section.classList.remove('is-dragging');
    if (open) {
      if (openSection && openSection !== section) setRailOpen(openSection, false, true);
      openSection = section;
    } else if (openSection === section) {
      openSection = null;
    }
    // After the snap frame, drop the inline transform so :focus-within CSS can reopen.
    if (animate) {
      window.setTimeout(() => {
        content.style.transition = '';
        content.style.transform = '';
      }, snapDuration());
    } else {
      content.style.transform = '';
      content.style.transition = '';
    }
  };

  const closeOpenRail = (animate) => {
    if (!openSection) return;
    setRailOpen(openSection, false, animate);
  };

  if (SWIPE_ENABLED) {
    blocks.forEach((block) => {
      const text = normalizeText(block.innerText);
      if (!text) return;

      const content = document.createElement('div');
      content.className = 'reader-swipe-content';
      while (block.firstChild) content.appendChild(block.firstChild);

      const rail = document.createElement('div');
      rail.className = 'reader-swipe-rail';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reader-swipe-ask';
      button.setAttribute('aria-label', 'Ask questions about this paragraph');
      button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h8"/><path d="M12 8v8"/></svg><span>Ask</span>';
      button.addEventListener('focus', () => {
        if (openSection && openSection !== block) setRailOpen(openSection, false, true);
        block.classList.add('is-open');
        openSection = block;
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const payloadText = normalizeText(block.innerText).slice(0, 4000);
        const blockId = block.dataset.blockId || '';
        if (!payloadText || !blockId || !CHAPTER_ID) return;
        send({
          type: 'ask-context',
          text: payloadText,
          blockId,
          chapterId: CHAPTER_ID
        });
        closeOpenRail(true);
        window.getSelection()?.removeAllRanges();
      });
      rail.appendChild(button);
      block.appendChild(rail);
      block.appendChild(content);
      block.classList.add('reader-swipe-block');
    });
  }

  let selectionTimer;
  document.addEventListener('selectionchange', () => {
    if (SWIPE_ENABLED) closeOpenRail(true);
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
        chapterId: CHAPTER_ID
      });
    }, 180);
  });

  let startY = 0;
  let startX = 0;
  let edge = null;
  let released = false;
  let swipeArmed = false;
  let axisLock = null;
  let activeSection = null;
  let wasOpenAtStart = false;
  let startOffset = 0;
  let gestureIgnore = false;

  const clearPullDataset = () => {
    delete document.body.dataset.pullEdge;
    delete document.body.dataset.pullState;
  };

  document.addEventListener('touchstart', (event) => {
    send({ type: 'tap' });
    const touch = event.touches[0];
    startX = touch?.clientX || 0;
    startY = touch?.clientY || 0;
    edge = window.scrollY <= 0 ? 'top' :
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1 ? 'bottom' : null;
    released = false;
    swipeArmed = false;
    axisLock = null;
    activeSection = null;
    wasOpenAtStart = false;
    startOffset = 0;
    gestureIgnore = false;

    if (!SWIPE_ENABLED) return;
    if (event.touches.length !== 1) {
      gestureIgnore = true;
      return;
    }
    const target = event.target;
    if (target?.closest?.('.reader-swipe-ask')) {
      gestureIgnore = true;
      return;
    }
    if (startX < EDGE_GUARD || startX > window.innerWidth - EDGE_GUARD) {
      gestureIgnore = true;
      return;
    }
    if (window.getSelection()?.toString().trim()) {
      gestureIgnore = true;
      return;
    }

    const section = target?.closest?.('section.reader-swipe-block');
    if (!section) {
      if (target?.closest?.('[data-block-id]')) closeOpenRail(true);
      return;
    }

    activeSection = section;
    wasOpenAtStart = section.classList.contains('is-open');
    startOffset = wasOpenAtStart ? REVEAL_DISTANCE : 0;
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    const touch = event.touches[0];
    const clientX = touch?.clientX || 0;
    const clientY = touch?.clientY || 0;
    const deltaX = clientX - startX;
    const deltaY = clientY - startY;

    if (SWIPE_ENABLED && !gestureIgnore && activeSection && event.touches.length === 1) {
      if (!axisLock) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);
        if (absX < INTENT_DISTANCE && absY < INTENT_DISTANCE) {
          // Intent still pending.
        } else if (wasOpenAtStart) {
          if (absX >= HORIZONTAL_RATIO * absY) {
            axisLock = 'horizontal';
            swipeArmed = true;
            activeSection.classList.add('is-dragging');
            if (openSection && openSection !== activeSection) {
              setRailOpen(openSection, false, true);
            }
            clearPullDataset();
            edge = null;
            released = false;
            const content = contentEl(activeSection);
            if (content) content.style.transition = 'none';
          } else {
            axisLock = 'vertical';
            closeOpenRail(true);
          }
        } else if (deltaX >= INTENT_DISTANCE && deltaX >= HORIZONTAL_RATIO * absY) {
          axisLock = 'horizontal';
          swipeArmed = true;
          activeSection.classList.add('is-dragging');
          if (openSection && openSection !== activeSection) {
            setRailOpen(openSection, false, true);
          }
          clearPullDataset();
          edge = null;
          released = false;
          const content = contentEl(activeSection);
          if (content) content.style.transition = 'none';
        } else {
          axisLock = 'vertical';
          closeOpenRail(true);
        }
      }

      if (axisLock === 'horizontal' && swipeArmed) {
        event.preventDefault();
        const next = Math.max(0, Math.min(REVEAL_DISTANCE, startOffset + deltaX));
        const content = contentEl(activeSection);
        if (content) {
          content.style.transition = 'none';
          content.style.transform = 'translateX(' + next + 'px)';
        }
        return;
      }
    }

    if (swipeArmed) return;
    if (!edge) return;
    const delta = clientY - startY;
    const distance = edge === 'top' ? delta : -delta;
    const nextReleased = distance >= 72;
    if (distance > 10) {
      document.body.dataset.pullEdge = edge;
      document.body.dataset.pullState = nextReleased ? 'release' : 'pull';
      send({ type: 'pull-state', edge, state: nextReleased ? 'release' : 'pull' });
    }
    released = nextReleased;
  }, { passive: false });

  const finishGesture = (cancelled) => {
    if (SWIPE_ENABLED && swipeArmed && activeSection) {
      const content = contentEl(activeSection);
      const current = content
        ? Number.parseFloat(String(content.style.transform).replace(/[^\\d.-]/g, '')) || 0
        : startOffset;
      let shouldOpen;
      if (cancelled) {
        shouldOpen = wasOpenAtStart;
      } else if (wasOpenAtStart) {
        shouldOpen = current > CLOSE_THRESHOLD;
      } else {
        shouldOpen = current >= OPEN_THRESHOLD;
      }
      setRailOpen(activeSection, shouldOpen, true);
    } else if (SWIPE_ENABLED && axisLock === 'vertical') {
      closeOpenRail(true);
    }

    if (!cancelled && edge && released && !swipeArmed) {
      send({ type: 'navigate', direction: edge === 'top' ? 'previous' : 'next' });
    }
    clearPullDataset();
    edge = null;
    released = false;
    swipeArmed = false;
    axisLock = null;
    activeSection = null;
    wasOpenAtStart = false;
    startOffset = 0;
    gestureIgnore = false;
  };

  document.addEventListener('touchend', (event) => {
    const touch = event.changedTouches[0];
    const endX = touch?.clientX || startX;
    const endY = touch?.clientY || startY;
    if (
      SWIPE_ENABLED &&
      !swipeArmed &&
      axisLock === null &&
      activeSection &&
      wasOpenAtStart &&
      Math.abs(endX - startX) < 8 &&
      Math.abs(endY - startY) < 8
    ) {
      closeOpenRail(true);
      clearPullDataset();
      edge = null;
      released = false;
      activeSection = null;
      wasOpenAtStart = false;
      startOffset = 0;
      gestureIgnore = false;
      return;
    }
    finishGesture(false);
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    if (SWIPE_ENABLED && swipeArmed && activeSection) {
      setRailOpen(activeSection, wasOpenAtStart, true);
      clearPullDataset();
      edge = null;
      released = false;
      swipeArmed = false;
      axisLock = null;
      activeSection = null;
      wasOpenAtStart = false;
      startOffset = 0;
      gestureIgnore = false;
      return;
    }
    if (SWIPE_ENABLED && axisLock === 'vertical') {
      closeOpenRail(true);
    }
    finishGesture(true);
  }, { passive: true });
})();
true;
`;

const swipeStyles = (isDark: boolean) => `
    html, body { overflow-x: clip; overscroll-behavior-x: none; }
    section.reader-swipe-block {
      position: relative;
      min-height: 44px;
    }
    .reader-swipe-rail {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 84px;
      z-index: 0;
      display: flex;
      align-items: flex-start;
      justify-content: flex-start;
      pointer-events: none;
    }
    section.reader-swipe-block.is-open > .reader-swipe-rail,
    .reader-swipe-rail:focus-within {
      pointer-events: auto;
    }
    .reader-swipe-ask {
      box-sizing: border-box;
      width: 72px;
      height: 44px;
      margin: 0;
      padding: 0 8px;
      border: 0;
      border-radius: 12px;
      background: ${color.accentSoft};
      color: ${color.ink};
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      white-space: nowrap;
      box-shadow: none;
    }
    .reader-swipe-ask:focus {
      outline: 2px solid ${color.focus};
      outline-offset: 2px;
    }
    .reader-swipe-ask:active {
      transform: translateY(1px);
    }
    .reader-swipe-ask svg {
      flex-shrink: 0;
    }
    .reader-swipe-content {
      position: relative;
      z-index: 1;
      box-sizing: border-box;
      border-radius: 8px;
      border-left: 2px solid transparent;
      background: ${isDark ? color.darkPaper : color.paper};
      box-shadow: none;
      transform: translateX(0);
      will-change: transform;
      transition:
        transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
        background-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
        border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
        box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    section.reader-swipe-block.is-open > .reader-swipe-content,
    .reader-swipe-rail:focus-within + .reader-swipe-content {
      transform: translateX(84px);
    }
    section.reader-swipe-block.is-dragging > .reader-swipe-content,
    section.reader-swipe-block.is-open > .reader-swipe-content,
    .reader-swipe-rail:focus-within + .reader-swipe-content {
      background: color-mix(
        in srgb,
        ${color.accent} 12%,
        ${isDark ? color.darkPaper : color.paper}
      );
      border-left-color: color-mix(in srgb, ${color.accent} 45%, transparent);
      box-shadow:
        0 10px 15px -3px rgba(23, 37, 50, 0.14),
        0 4px 6px -4px rgba(23, 37, 50, 0.1);
    }
    @media (prefers-reduced-motion: reduce) {
      .reader-swipe-content {
        transition-duration: 16ms;
      }
    }
`;

const createDocument = (
    chapter: EpubReaderChapter,
    blocks: string[],
    isDark: boolean,
    swipeActionsEnabled: boolean
) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    :root { color-scheme: ${isDark ? "dark" : "light"}; }
    html, body { overflow-x: clip;${swipeActionsEnabled ? " overscroll-behavior-x: none;" : ""} }
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
    ${swipeActionsEnabled ? swipeStyles(isDark) : ""}
  </style>
</head>
<body>
  <main>${blocks.join("")}</main>
  <script>${bridgeScript(chapter.id, swipeActionsEnabled)}</script>
</body>
</html>`;

export const EpubChapterView = ({
    bookId,
    chapter,
    isDark,
    restoreBlockId,
    swipeActionsEnabled,
    onVisibleBlock,
    onSelection,
    onNavigate,
}: {
    bookId: string;
    chapter: EpubReaderChapter;
    isDark: boolean;
    restoreBlockId?: string | null;
    swipeActionsEnabled: boolean;
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
            setHtml(
                createDocument(chapter, blocks, isDark, swipeActionsEnabled)
            );
        });
        return () => {
            cancelled = true;
        };
    }, [bookId, chapter, isDark, resourceIds, swipeActionsEnabled]);

    const handleMessage = (event: WebViewMessageEvent) => {
        try {
            const message = JSON.parse(
                event.nativeEvent.data
            ) as ReaderBridgeMessage;
            const highlight = readerHighlightContextFromMessage(message);
            if (highlight) {
                onSelection(highlight);
                return;
            }
            if (message.type === "visible-block") {
                onVisibleBlock(message.blockId);
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
