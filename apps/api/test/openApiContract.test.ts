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
    "/api/auth/signup",
    "/api/auth/login",
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

test("OpenAPI advertises the active environment cookie without global env mutation", () => {
    const development = createOpenApiSpec({
        nodeEnv: "development",
    }) as OpenApiRecord;
    const production = createOpenApiSpec({
        nodeEnv: "production",
    }) as OpenApiRecord;

    assert.deepEqual(development.security, [{ readerSession: [] }]);
    assert.equal(
        development.components.securitySchemes.readerSession.name,
        "reader_session"
    );
    assert.match(
        development.components.securitySchemes.readerSession.description,
        /alternate environment uses __Host-reader_session/
    );
    assert.equal(
        production.components.securitySchemes.readerSession.name,
        "__Host-reader_session"
    );
    assert.match(
        production.components.securitySchemes.readerSession.description,
        /alternate environment uses reader_session/
    );

    for (const [pathName, method] of [
        ["/health", "get"],
        ["/api/auth/google", "post"],
        ["/api/auth/dev", "post"],
        ["/api/auth/signup", "post"],
        ["/api/auth/login", "post"],
        ["/api/auth/logout", "post"],
    ]) {
        assert.deepEqual(development.paths[pathName][method].security, []);
    }

    const serialized = JSON.stringify(development).toLowerCase();
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
    assert.deepEqual(spec.components.schemas.ChatRequest.properties.model, {
        type: "string",
        enum: ["gpt-4o-mini", "gpt-5.5-2026-04-23", "gpt-5.4-mini-2026-03-17"],
        default: "gpt-4o-mini",
        description: "Optional model override. Unsupported values return 400.",
    });

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
    assert.ok(
        spec.paths["/api/books/{bookId}"].get.responses["200"].content[
            "application/octet-stream"
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

test("OpenAPI exposes machine-readable chat stream events and DONE framing", () => {
    const spec = createOpenApiSpec() as OpenApiRecord;
    const streamSchema = spec.components.schemas.ChatStreamEvent;
    assert.deepEqual(streamSchema.oneOf, [
        { $ref: "#/components/schemas/ChatConversationEvent" },
        { $ref: "#/components/schemas/ChatContentEvent" },
        { $ref: "#/components/schemas/ChatSourcesEvent" },
        { $ref: "#/components/schemas/ChatContextErrorEvent" },
        { $ref: "#/components/schemas/ChatFatalErrorEvent" },
        { $ref: "#/components/schemas/ChatTerminalEvent" },
    ]);
    assert.match(streamSchema.description, /\[DONE\]/);
    assert.match(streamSchema.description, /fatal error/i);
    assert.deepEqual(spec.components.schemas.ChatFatalErrorEvent.required, [
        "error",
    ]);
    assert.deepEqual(
        spec.components.schemas.ChatFatalErrorEvent.properties.error.enum,
        ["An error occurred"]
    );

    for (const pathName of [
        "/api/{resourceType}/{bookId}/conversations",
        "/api/{resourceType}/{bookId}/conversations/{conversationId}/messages",
    ]) {
        assert.equal(
            spec.paths[pathName].post.responses["200"].content[
                "text/event-stream"
            ].schema.$ref,
            "#/components/schemas/ChatStreamEvent"
        );
    }
});

test("OpenAPI references the reusable internal error response", () => {
    const spec = createOpenApiSpec() as OpenApiRecord;
    const operations = [
        ["/api/auth/dev", "post"],
        ["/api/books", "get"],
        ["/api/books", "post"],
        ["/api/books/{bookId}", "get"],
        ["/api/books/{bookId}", "delete"],
        ["/api/books/{bookId}/status", "get"],
        ["/api/books/{bookId}/retry", "post"],
        ["/api/{bookId}/progress", "get"],
        ["/api/{bookId}/progress", "post"],
        ["/api/{resourceType}/{bookId}/conversations", "get"],
        ["/api/{resourceType}/{bookId}/conversations", "post"],
        [
            "/api/{resourceType}/{bookId}/conversations/{conversationId}/messages",
            "post",
        ],
        ["/api/{resourceType}/{bookId}/conversations/{conversationId}", "get"],
    ];

    assert.ok(spec.components.responses.InternalError);
    for (const [pathName, method] of operations) {
        assert.equal(
            spec.paths[pathName][method].responses["500"].$ref,
            "#/components/responses/InternalError",
            `${method.toUpperCase()} ${pathName}`
        );
    }
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
