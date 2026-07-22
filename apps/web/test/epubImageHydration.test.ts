import assert from "node:assert/strict";
import test from "node:test";

type PendingKey = string;

const pendingKey = (chapterId: string, cacheKey: string): PendingKey =>
    `${chapterId}::${cacheKey}`;

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
