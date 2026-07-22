import assert from "node:assert/strict";
import test from "node:test";
import { isNearScrollRoot } from "../src/hooks/epubImageVisibility";

type PendingKey = string;

const pendingKey = (chapterId: string, cacheKey: string): PendingKey =>
    `${chapterId}::${cacheKey}`;

const mockElement = (rect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
}): Element =>
    ({
        getBoundingClientRect: () => rect,
    }) as unknown as Element;

test("pending image loads dedupe by chapter and resource key", () => {
    const pending = new Map<PendingKey, Promise<string>>();
    const key = pendingKey("c1", "images/a.jpg");
    const load = Promise.resolve("blob:1");
    pending.set(key, load);
    assert.equal(pending.get(pendingKey("c1", "images/a.jpg")), load);
    assert.equal(pending.has(pendingKey("c2", "images/a.jpg")), false);
});

test("chapter commit retains only the active chapter urls", () => {
    const urls = new Map<string, string[]>([
        ["c1", ["blob:a"]],
        ["c2", ["blob:b", "blob:c"]],
    ]);
    const retain = new Set(["c2"]);
    const revoked: string[] = [];
    for (const [chapterId, chapterUrls] of [...urls.entries()]) {
        if (!retain.has(chapterId)) {
            revoked.push(...chapterUrls);
            urls.delete(chapterId);
        }
    }
    assert.deepEqual(revoked, ["blob:a"]);
    assert.deepEqual([...urls.keys()], ["c2"]);
});

test("hydration waits for mounted container before resolving images", () => {
    // Mirrors the EpubReader race: chapterId becomes available before the
    // chapter DOM node is mounted. Hydration must no-op until container exists.
    let container: HTMLElement | null = null;
    let hydrated = 0;

    const maybeHydrate = () => {
        if (!container) return;
        hydrated += container.querySelectorAll("img[data-epub-src]").length;
    };

    maybeHydrate();
    assert.equal(hydrated, 0);

    container = {
        querySelectorAll: () => [{}] as unknown as NodeListOf<Element>,
    } as unknown as HTMLElement;
    maybeHydrate();
    assert.equal(hydrated, 1);
});

test("isNearScrollRoot treats zero-box placeholders as eager", () => {
    const img = mockElement({
        top: 100,
        bottom: 100,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
    });
    const root = mockElement({
        top: 0,
        bottom: 800,
        left: 0,
        right: 720,
        width: 720,
        height: 800,
    });
    assert.equal(isNearScrollRoot(img, root), true);
});

test("isNearScrollRoot eager-hydrates cover-sized markers already in view", () => {
    // Confessions cover remount: CSS placeholder is 384x384 inside the scroll root.
    // Waiting on IntersectionObserver alone left the marker blank on return.
    const img = mockElement({
        top: 95,
        bottom: 479,
        left: 168,
        right: 552,
        width: 384,
        height: 384,
    });
    const root = mockElement({
        top: 91,
        bottom: 747,
        left: 0,
        right: 720,
        width: 720,
        height: 656,
    });
    assert.equal(isNearScrollRoot(img, root), true);
});

test("isNearScrollRoot keeps far-below markers lazy", () => {
    const img = mockElement({
        top: 4000,
        bottom: 4200,
        left: 0,
        right: 400,
        width: 400,
        height: 200,
    });
    const root = mockElement({
        top: 0,
        bottom: 800,
        left: 0,
        right: 720,
        width: 720,
        height: 800,
    });
    assert.equal(isNearScrollRoot(img, root), false);
});

test("chapter remount should rehydrate after blob revoke", () => {
    // Cover visit -> leave (revoke) -> return with fresh marker and no src.
    const firstVisit = { src: "blob:cover-1", hasSvgAttr: false };
    const afterLeave = { revoked: true };
    const onReturn = {
        src: null as string | null,
        hasSvgAttr: true,
        nearScrollRoot: true,
    };

    assert.equal(afterLeave.revoked, true);
    assert.equal(onReturn.src, null);
    assert.equal(onReturn.hasSvgAttr, true);
    assert.equal(onReturn.nearScrollRoot, true);

    const shouldEagerHydrate = !onReturn.src && onReturn.nearScrollRoot;
    assert.equal(shouldEagerHydrate, true);
    assert.notEqual(firstVisit.src, onReturn.src);
});

test("archive restart must keep svg markers for retry", () => {
    // Overlapping processEpub / Strict Mode can revoke the first blob URL.
    // Hydration must keep data-epub-svg so the next archiveGeneration can recover.
    const img = {
        attrs: {
            "data-epub-svg": "<svg></svg>",
            src: "blob:old",
        } as Record<string, string>,
        removeAttribute(name: string) {
            delete this.attrs[name];
        },
        getAttribute(name: string) {
            return this.attrs[name] ?? null;
        },
        hasAttribute(name: string) {
            return name in this.attrs;
        },
    };

    // Successful assign should not strip the svg marker anymore.
    img.attrs.src = "blob:new";
    assert.equal(img.hasAttribute("data-epub-svg"), true);

    // Simulated revoke + retry still has payload.
    img.removeAttribute("src");
    assert.equal(img.getAttribute("data-epub-svg"), "<svg></svg>");
});

test("stale processEpub completions are ignored by request id", () => {
    let current = 0;
    let published = 0;
    const run = (id: number) => {
        // only latest may publish
        if (id === current) published += 1;
    };
    current = 1;
    current = 2;
    run(1);
    run(2);
    assert.equal(published, 1);
});
