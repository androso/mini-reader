import assert from "node:assert/strict";
import test from "node:test";
import { ImageObjectUrlRegistry } from "../src/hooks/imageObjectUrlRegistry";

const setup = () => {
    const revoked: string[] = [];
    return {
        registry: new ImageObjectUrlRegistry((url) => revoked.push(url)),
        revoked,
    };
};

test("archive switching revokes old URLs without reusing them across books", () => {
    const { registry, revoked } = setup();
    const firstBook = registry.startArchive();
    assert.equal(registry.register(firstBook, "c1", "blob:first"), true);

    const secondBook = registry.startArchive();
    assert.deepEqual(revoked, ["blob:first"]);
    assert.equal(registry.isCurrent(firstBook), false);
    assert.equal(registry.register(secondBook, "c1", "blob:second"), true);
    assert.deepEqual(revoked, ["blob:first"]);
});

test("unmount cleanup revokes every remaining URL exactly once", () => {
    const { registry, revoked } = setup();
    const generation = registry.startArchive();
    registry.register(generation, "c1", "blob:one");
    registry.register(generation, "c2", "blob:two");

    registry.dispose(generation);
    registry.dispose(generation);
    assert.deepEqual(revoked, ["blob:one", "blob:two"]);
});

test("a stale async completion is revoked instead of joining the new archive", async () => {
    const { registry, revoked } = setup();
    const staleGeneration = registry.startArchive();
    const completion = Promise.resolve("blob:stale");
    registry.startArchive();

    assert.equal(
        registry.register(staleGeneration, "c1", await completion),
        false
    );
    assert.deepEqual(revoked, ["blob:stale"]);
});

test("active URLs are not revoked before their archive retires", () => {
    const { registry, revoked } = setup();
    const generation = registry.startArchive();
    assert.equal(registry.register(generation, "c1", "blob:active"), true);
    assert.equal(registry.register(generation, "c1", "blob:active"), true);
    assert.deepEqual(revoked, []);

    registry.dispose(generation);
    assert.deepEqual(revoked, ["blob:active"]);
});

test("retainChapters releases outgoing chapter URLs after commit", () => {
    const { registry, revoked } = setup();
    const generation = registry.startArchive();
    registry.register(generation, "c1", "blob:c1");
    registry.register(generation, "c2", "blob:c2a");
    registry.register(generation, "c2", "blob:c2b");

    registry.retainChapters(["c2"]);
    assert.deepEqual(revoked, ["blob:c1"]);

    registry.releaseChapter("c2");
    assert.deepEqual(revoked, ["blob:c1", "blob:c2a", "blob:c2b"]);
});

test("stale chapter registration is rejected when chapter id is empty", () => {
    const { registry, revoked } = setup();
    const generation = registry.startArchive();
    assert.equal(registry.register(generation, "", "blob:empty"), false);
    assert.deepEqual(revoked, ["blob:empty"]);
});
