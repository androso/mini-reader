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
    assert.equal(registry.register(firstBook, "blob:first"), true);

    const secondBook = registry.startArchive();
    assert.deepEqual(revoked, ["blob:first"]);
    assert.equal(registry.isCurrent(firstBook), false);
    assert.equal(registry.register(secondBook, "blob:second"), true);
    assert.deepEqual(revoked, ["blob:first"]);
});

test("unmount cleanup revokes every remaining URL exactly once", () => {
    const { registry, revoked } = setup();
    const generation = registry.startArchive();
    registry.register(generation, "blob:one");
    registry.register(generation, "blob:two");

    registry.dispose(generation);
    registry.dispose(generation);
    assert.deepEqual(revoked, ["blob:one", "blob:two"]);
});

test("a stale async completion is revoked instead of joining the new archive", async () => {
    const { registry, revoked } = setup();
    const staleGeneration = registry.startArchive();
    const completion = Promise.resolve("blob:stale");
    registry.startArchive();

    assert.equal(registry.register(staleGeneration, await completion), false);
    assert.deepEqual(revoked, ["blob:stale"]);
});

test("active URLs are not revoked before their archive retires", () => {
    const { registry, revoked } = setup();
    const generation = registry.startArchive();
    assert.equal(registry.register(generation, "blob:active"), true);
    assert.equal(registry.register(generation, "blob:active"), true);
    assert.deepEqual(revoked, []);

    registry.dispose(generation);
    assert.deepEqual(revoked, ["blob:active"]);
});
