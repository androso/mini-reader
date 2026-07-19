import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sourceFiles = [
    "src/lib/auth.ts",
    "src/lib/queryClient.ts",
    "src/app/page.tsx",
    "src/components/BookCover.tsx",
    "src/components/bookCoverLoading.ts",
    "src/components/reader/PdfReader.tsx",
    "src/hooks/chat/useChat.ts",
    "src/hooks/chat/useConversations.ts",
    "src/hooks/chat/useSelectedConversation.ts",
    "src/hooks/useBookProcessingStatus.ts",
    "src/hooks/useEpubProcessor.ts",
    "src/hooks/useTextBlockNavigation.ts",
];

const readSource = (path: string) => readFileSync(path, "utf8");

test("Reader browser transport does not persist or construct bearer sessions", () => {
    const source = sourceFiles.map(readSource).join("\n");
    assert.doesNotMatch(
        source,
        /localStorage\.(?:getItem|setItem|removeItem)\(["'](?:token|user)["']/
    );
    assert.doesNotMatch(source, /Authorization\s*:/);
    assert.doesNotMatch(source, /Bearer\s+\$\{/);
});

test("authenticated browser requests include cookies", () => {
    for (const path of sourceFiles) {
        const source = readSource(path);
        if (!source.includes("fetch(")) continue;
        const fetchCount = source.match(/fetch\(/g)?.length ?? 0;
        const credentialCount =
            source.match(/credentials:\s*["']include["']/g)?.length ?? 0;
        assert.equal(
            credentialCount,
            fetchCount,
            `${path} contains a fetch without credentials: include`
        );
    }
    assert.match(
        readSource("src/hooks/useEpubProcessor.ts"),
        /requestCredentials:\s*true/
    );
});
