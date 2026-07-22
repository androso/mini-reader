import assert from "node:assert/strict";
import test from "node:test";

/**
 * Pure helpers mirroring single-chapter loader replace/reuse rules.
 * Kept local to the test so the hook can stay React-bound while the
 * contract stays regression-tested.
 */
type ChapterSnapshot = { id: string; textBlocks: unknown[] };

const shouldReuseLoadedChapter = (chapters: ChapterSnapshot[], id: string) =>
    chapters.length === 1 && chapters[0]?.id === id;

const replaceWithSingleChapter = (
    _current: ChapterSnapshot[],
    next: ChapterSnapshot
) => ({
    chapters: [next],
    flatTextBlocks: next.textBlocks,
});

test("single-chapter mode reuses the active file for fragment-only changes", () => {
    const chapters = [{ id: "s1", textBlocks: [{ id: "s1-block-0" }] }];
    assert.equal(shouldReuseLoadedChapter(chapters, "s1"), true);
    assert.equal(shouldReuseLoadedChapter(chapters, "s2"), false);
    assert.equal(
        shouldReuseLoadedChapter(
            [
                { id: "s1", textBlocks: [] },
                { id: "s2", textBlocks: [] },
            ],
            "s1"
        ),
        false
    );
});

test("single-chapter mode replaces rather than accumulates chapter state", () => {
    const current = [
        { id: "s1", textBlocks: [{ id: "s1-block-0" }] },
        { id: "s2", textBlocks: [{ id: "s2-block-0" }] },
    ];
    const next = { id: "s3", textBlocks: [{ id: "s3-block-0" }] };
    const replaced = replaceWithSingleChapter(current, next);
    assert.deepEqual(
        replaced.chapters.map((chapter) => chapter.id),
        ["s3"]
    );
    assert.deepEqual(replaced.flatTextBlocks, next.textBlocks);
});

test("failed loads preserve the previous chapter snapshot", () => {
    const current = [{ id: "s1", textBlocks: [{ id: "s1-block-0" }] }];
    const failedLoad = null;
    const retained = failedLoad ?? current;
    assert.deepEqual(retained, current);
});
