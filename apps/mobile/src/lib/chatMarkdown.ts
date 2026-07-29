export type InlineNode =
    | { type: "text"; value: string }
    | { type: "strong"; children: InlineNode[] }
    | { type: "em"; children: InlineNode[] }
    | { type: "code"; value: string }
    | { type: "link"; href: string; children: InlineNode[] };

export type BlockNode =
    | { type: "paragraph"; children: InlineNode[] }
    | { type: "heading"; level: number; children: InlineNode[] }
    | { type: "code"; value: string }
    | { type: "blockquote"; children: BlockNode[] }
    | { type: "list"; ordered: boolean; items: InlineNode[][] };

const takeInlineCode = (input: string, start: number) => {
    if (input[start] !== "`") return null;
    let end = start + 1;
    while (end < input.length && input[end] !== "`") end += 1;
    if (end >= input.length) return null;
    return {
        node: {
            type: "code",
            value: input.slice(start + 1, end),
        } as InlineNode,
        next: end + 1,
    };
};

const takeLink = (input: string, start: number) => {
    if (input[start] !== "[") return null;
    let depth = 1;
    let i = start + 1;
    while (i < input.length && depth > 0) {
        if (input[i] === "\\") {
            i += 2;
            continue;
        }
        if (input[i] === "[") depth += 1;
        else if (input[i] === "]") depth -= 1;
        i += 1;
    }
    if (depth !== 0 || input[i] !== "(") return null;
    const label = input.slice(start + 1, i - 1);
    let j = i + 1;
    while (j < input.length && /\s/.test(input[j]!)) j += 1;
    let href = "";
    if (input[j] === "<") {
        const close = input.indexOf(">", j + 1);
        if (close < 0) return null;
        href = input.slice(j + 1, close).trim();
        j = close + 1;
    } else {
        while (j < input.length && input[j] !== ")" && !/\s/.test(input[j]!)) {
            href += input[j];
            j += 1;
        }
    }
    while (j < input.length && /\s/.test(input[j]!)) j += 1;
    if (input[j] !== ")") return null;
    return {
        node: {
            type: "link",
            href,
            children: parseInline(label),
        } as InlineNode,
        next: j + 1,
    };
};

const takeDelimited = (
    input: string,
    start: number,
    marker: string,
    type: "strong" | "em"
) => {
    if (!input.startsWith(marker, start)) return null;
    const close = input.indexOf(marker, start + marker.length);
    if (close < 0) return null;
    const inner = input.slice(start + marker.length, close);
    if (!inner) return null;
    return {
        node: { type, children: parseInline(inner) } as InlineNode,
        next: close + marker.length,
    };
};

export const parseInline = (input: string): InlineNode[] => {
    const nodes: InlineNode[] = [];
    let i = 0;
    let text = "";
    const flush = () => {
        if (!text) return;
        nodes.push({ type: "text", value: text });
        text = "";
    };

    while (i < input.length) {
        if (input[i] === "\\" && i + 1 < input.length) {
            text += input[i + 1];
            i += 2;
            continue;
        }
        if (input.startsWith("![", i)) {
            const link = takeLink(input, i + 1);
            if (link && link.node.type === "link") {
                flush();
                const alt = flattenInlineText(link.node.children);
                nodes.push({ type: "text", value: alt });
                i = link.next;
                continue;
            }
        }
        const code = takeInlineCode(input, i);
        if (code) {
            flush();
            nodes.push(code.node);
            i = code.next;
            continue;
        }
        const link = takeLink(input, i);
        if (link) {
            flush();
            nodes.push(link.node);
            i = link.next;
            continue;
        }
        const strongStar = takeDelimited(input, i, "**", "strong");
        if (strongStar) {
            flush();
            nodes.push(strongStar.node);
            i = strongStar.next;
            continue;
        }
        const strongUnder = takeDelimited(input, i, "__", "strong");
        if (strongUnder) {
            flush();
            nodes.push(strongUnder.node);
            i = strongUnder.next;
            continue;
        }
        const emStar = takeDelimited(input, i, "*", "em");
        if (emStar) {
            flush();
            nodes.push(emStar.node);
            i = emStar.next;
            continue;
        }
        const emUnder = takeDelimited(input, i, "_", "em");
        if (emUnder) {
            flush();
            nodes.push(emUnder.node);
            i = emUnder.next;
            continue;
        }
        text += input[i];
        i += 1;
    }
    flush();
    return nodes;
};

export const flattenInlineText = (nodes: InlineNode[]): string =>
    nodes
        .map((node) => {
            if (node.type === "text" || node.type === "code") return node.value;
            if (
                node.type === "link" ||
                node.type === "strong" ||
                node.type === "em"
            )
                return flattenInlineText(node.children);
            return "";
        })
        .join("");

const parseListItems = (lines: string[], ordered: boolean) => {
    const pattern = ordered ? /^\d+\.\s+(.*)$/ : /^[-*+]\s+(.*)$/;
    const items: InlineNode[][] = [];
    for (const line of lines) {
        const match = line.match(pattern);
        if (!match) break;
        items.push(parseInline(match[1] ?? ""));
    }
    return items;
};

export const parseMarkdownBlocks = (input: string): BlockNode[] => {
    const normalized = input.replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    const blocks: BlockNode[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i] ?? "";
        if (!line.trim()) {
            i += 1;
            continue;
        }

        if (line.startsWith("```")) {
            const fence = line.slice(3).trim();
            i += 1;
            const body: string[] = [];
            while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
                body.push(lines[i] ?? "");
                i += 1;
            }
            if (i < lines.length) i += 1;
            blocks.push({ type: "code", value: body.join("\n") });
            void fence;
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            blocks.push({
                type: "heading",
                level: heading[1]!.length,
                children: parseInline(heading[2] ?? ""),
            });
            i += 1;
            continue;
        }

        if (/^>\s?/.test(line)) {
            const quoted: string[] = [];
            while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
                quoted.push((lines[i] ?? "").replace(/^>\s?/, ""));
                i += 1;
            }
            blocks.push({
                type: "blockquote",
                children: parseMarkdownBlocks(quoted.join("\n")),
            });
            continue;
        }

        if (/^([-*+]|\d+\.)\s+/.test(line)) {
            const ordered = /^\d+\.\s+/.test(line);
            const listLines: string[] = [];
            while (
                i < lines.length &&
                (ordered
                    ? /^\d+\.\s+/.test(lines[i] ?? "")
                    : /^[-*+]\s+/.test(lines[i] ?? ""))
            ) {
                listLines.push(lines[i] ?? "");
                i += 1;
            }
            blocks.push({
                type: "list",
                ordered,
                items: parseListItems(listLines, ordered),
            });
            continue;
        }

        const paragraph: string[] = [line];
        i += 1;
        while (
            i < lines.length &&
            (lines[i] ?? "").trim() &&
            !/^(```|#{1,6}\s|[>*+-]\s|\d+\.\s)/.test(lines[i] ?? "")
        ) {
            paragraph.push(lines[i] ?? "");
            i += 1;
        }
        blocks.push({
            type: "paragraph",
            children: parseInline(paragraph.join("\n")),
        });
    }

    return blocks;
};
