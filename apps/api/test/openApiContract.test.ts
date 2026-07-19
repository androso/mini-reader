import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
    createOpenApiSpec,
    resolveSwaggerRouteGlob,
} from "../src/utils/swagger";

type OpenApiRecord = Record<string, any>;

const expectedPaths = [
    "/health",
    "/api/auth/google",
    "/api/auth/dev",
    "/api/auth/logout",
    "/api/user",
    "/api/books",
    "/api/books/{bookId}/retry",
    "/api/books/{bookId}/status",
    "/api/books/{bookId}",
    "/api/{bookId}/progress",
    "/api/{resourceType}/{bookId}/conversations",
    "/api/{resourceType}/{bookId}/conversations/{conversationId}/messages",
    "/api/{resourceType}/{bookId}/conversations/{conversationId}",
];

const schemaProperties = (spec: OpenApiRecord, name: string) =>
    Object.keys(spec.components.schemas[name].properties).sort();

test("OpenAPI generation is independent of the process working directory", () => {
    const initialCwd = process.cwd();
    const apiDirectory = path.resolve(__dirname, "../../../apps/api");
    const rootDirectory = path.resolve(apiDirectory, "../..");

    try {
        for (const cwd of [rootDirectory, apiDirectory]) {
            process.chdir(cwd);
            const spec = createOpenApiSpec() as OpenApiRecord;
            assert.deepEqual(
                Object.keys(spec.paths).sort(),
                expectedPaths.sort()
            );
        }
    } finally {
        process.chdir(initialCwd);
    }

    assert.equal(path.isAbsolute(resolveSwaggerRouteGlob()), true);
});

test("OpenAPI advertises cookie sessions and public auth opt-outs", () => {
    const spec = createOpenApiSpec() as OpenApiRecord;
    assert.deepEqual(spec.security, [{ readerSession: [] }]);
    assert.deepEqual(spec.components.securitySchemes.readerSession, {
        type: "apiKey",
        in: "cookie",
        name: "__Host-reader_session",
        description:
            "Production HttpOnly session cookie. Development uses reader_session without Secure.",
    });

    for (const [pathName, method] of [
        ["/health", "get"],
        ["/api/auth/google", "post"],
        ["/api/auth/dev", "post"],
        ["/api/auth/logout", "post"],
    ]) {
        assert.deepEqual(spec.paths[pathName][method].security, []);
    }

    const serialized = JSON.stringify(spec).toLowerCase();
    assert.equal(serialized.includes('"scheme":"bearer"'), false);
    assert.equal(serialized.includes('"name":"authorization"'), false);
});

test("OpenAPI public schemas exclude private storage and execution fields", () => {
    const spec = createOpenApiSpec() as OpenApiRecord;
    assert.deepEqual(schemaProperties(spec, "PublicBook"), [
        "createdAt",
        "fileType",
        "id",
        "processingError",
        "processingStatus",
        "title",
    ]);
    assert.deepEqual(schemaProperties(spec, "PublicMessage"), [
        "completionStatus",
        "content",
        "contextSources",
        "conversationId",
        "createdAt",
        "finishReason",
        "id",
        "role",
    ]);
    assert.deepEqual(schemaProperties(spec, "ChatRequest"), [
        "highlightContext",
        "message",
        "model",
    ]);
    assert.deepEqual(spec.components.schemas.ChatRequest.required, ["message"]);

    for (const privateField of [
        "fileKey",
        "collectionName",
        "executionMetadata",
    ]) {
        assert.equal(
            Object.prototype.hasOwnProperty.call(
                spec.components.schemas.PublicBook.properties,
                privateField
            ) ||
                Object.prototype.hasOwnProperty.call(
                    spec.components.schemas.PublicMessage.properties,
                    privateField
                ),
            false,
            privateField
        );
    }

    assert.deepEqual(
        spec.components.schemas.ChatTerminalEvent.properties.status.enum,
        ["complete", "truncated", "cancelled", "failed"]
    );
    assert.ok(
        spec.paths["/api/books/{bookId}"].get.responses["200"].content[
            "application/pdf"
        ]
    );
    assert.ok(
        spec.paths["/api/books/{bookId}"].get.responses["200"].content[
            "application/epub+zip"
        ]
    );
    assert.equal(
        spec.paths["/api/books"].get.responses["200"].content[
            "application/json"
        ].schema.properties.books.items.$ref,
        "#/components/schemas/PublicBook"
    );
    assert.equal(
        spec.paths["/api/books"].post.responses["202"].content[
            "application/json"
        ].schema.properties.book.$ref,
        "#/components/schemas/PublicBook"
    );
    assert.equal(
        Object.keys(spec.paths).some((name) => /fileKey/i.test(name)),
        false
    );
});

test("OpenAPI documents trusted-origin and rate-limit responses", () => {
    const spec = createOpenApiSpec() as OpenApiRecord;
    assert.ok(spec.paths["/api/auth/google"].post.responses["403"]);
    assert.ok(spec.paths["/api/auth/google"].post.responses["429"]);
    assert.ok(spec.paths["/api/books"].post.responses["403"]);
    assert.ok(spec.paths["/api/books"].post.responses["429"]);
    assert.ok(spec.paths["/api/books/{bookId}/retry"].post.responses["403"]);
    assert.ok(
        spec.paths[
            "/api/{resourceType}/{bookId}/conversations/{conversationId}/messages"
        ].post.responses["403"]
    );
    assert.ok(
        spec.paths[
            "/api/{resourceType}/{bookId}/conversations/{conversationId}/messages"
        ].post.responses["429"]
    );
});
