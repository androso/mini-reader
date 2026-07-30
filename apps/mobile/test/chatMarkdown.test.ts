import assert from "node:assert/strict";
import test from "node:test";
import {
    flattenInlineText,
    parseInline,
    parseMarkdownBlocks,
} from "../src/lib/chatMarkdown.js";

test("parses bold, italic, and nested emphasis", () => {
    const nodes = parseInline(
        "Hello **British physicist** and **_The Fabric of Reality_**"
    );
    assert.deepEqual(
        nodes.map((node) => node.type),
        ["text", "strong", "text", "strong"]
    );
    const strong = nodes[1];
    assert.equal(strong?.type, "strong");
    if (strong?.type === "strong") {
        assert.equal(flattenInlineText(strong.children), "British physicist");
    }
    const nested = nodes[3];
    assert.equal(nested?.type, "strong");
    if (nested?.type === "strong") {
        assert.equal(nested.children[0]?.type, "em");
        assert.equal(
            flattenInlineText(nested.children),
            "The Fabric of Reality"
        );
    }
});

test("parses markdown links including angle-bracket destinations", () => {
    const nodes = parseInline(
        "See [royalsociety.org](https://royalsociety.org/people/david-deutsch-11329/) and [2](<https://www.constructortheory.org/about-us/>)"
    );
    const links = nodes.filter((node) => node.type === "link");
    assert.equal(links.length, 2);
    assert.equal(links[0]?.type, "link");
    if (links[0]?.type === "link") {
        assert.equal(
            links[0].href,
            "https://royalsociety.org/people/david-deutsch-11329/"
        );
        assert.equal(flattenInlineText(links[0].children), "royalsociety.org");
    }
    assert.equal(links[1]?.type, "link");
    if (links[1]?.type === "link") {
        assert.equal(
            links[1].href,
            "https://www.constructortheory.org/about-us/"
        );
    }
});

test("parses lists, headings, and fenced code blocks", () => {
    const blocks = parseMarkdownBlocks(
        [
            "## Overview",
            "",
            "- alpha",
            "- beta",
            "",
            "1. one",
            "2. two",
            "",
            "```",
            "const x = 1",
            "```",
            "",
            "Paragraph with `code`.",
        ].join("\n")
    );
    assert.equal(blocks[0]?.type, "heading");
    assert.equal(blocks[1]?.type, "list");
    if (blocks[1]?.type === "list") assert.equal(blocks[1].ordered, false);
    assert.equal(blocks[2]?.type, "list");
    if (blocks[2]?.type === "list") assert.equal(blocks[2].ordered, true);
    assert.equal(blocks[3]?.type, "code");
    if (blocks[3]?.type === "code")
        assert.equal(blocks[3].value, "const x = 1");
    assert.equal(blocks[4]?.type, "paragraph");
});

test("images degrade to alt text", () => {
    const nodes = parseInline("Look ![diagram](https://example.com/a.png) end");
    assert.deepEqual(nodes, [
        { type: "text", value: "Look " },
        { type: "text", value: "diagram" },
        { type: "text", value: " end" },
    ]);
});
