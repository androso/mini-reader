import assert from "node:assert/strict";
import test from "node:test";
import * as providers from "../src/index";

test("package index re-exports storage, vector store, and logger symbols", () => {
    assert.equal(typeof providers.ObjectStorageProvider, "function");
    assert.equal(typeof providers.PgVectorStore, "function");
    assert.equal(typeof providers.createLogger, "function");
    assert.equal(typeof providers.uploadFile, "function");
    assert.equal(typeof providers.getFile, "function");
    assert.equal(typeof providers.deleteFile, "function");
    assert.ok(providers.storageProvider);
});
