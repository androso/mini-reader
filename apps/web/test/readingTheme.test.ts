import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hookSource = readFileSync("src/hooks/useReadingTheme.ts", "utf8");
const homeSource = readFileSync("src/app/page.tsx", "utf8");
const readerSource = readFileSync("src/app/read/[id]/page.tsx", "utf8");
const stylesSource = readFileSync("src/app/globals.css", "utf8");

test("reading theme persists and is shared by home and reader surfaces", () => {
    assert.match(hookSource, /reader\.colorTheme/);
    assert.match(hookSource, /localStorage\.getItem/);
    assert.match(hookSource, /localStorage\.setItem/);
    assert.match(homeSource, /data-reading-theme=\{theme\}/);
    assert.match(readerSource, /data-reading-theme=\{theme\}/);
});

test("dark tokens are activated only by the explicit dark theme", () => {
    assert.match(
        stylesSource,
        /\.mentarie-shell\[data-reading-theme="dark"\] \.library-main/
    );
    assert.match(
        stylesSource,
        /\.reader-viewer-pane\[data-reading-theme="dark"\]/
    );
    assert.doesNotMatch(stylesSource, /\.auth-shell\[data-reading-theme/);
});
