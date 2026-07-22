import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { sanitizeEpubSvg } from "../src/svgSanitizer";

const requireFromApi = createRequire(
    path.resolve(process.cwd(), "../../apps/api/package.json")
);
const { JSDOM } = requireFromApi("jsdom") as {
    JSDOM: new (source: string) => { window: { document: Document } };
};

const doc = () =>
    new JSDOM("<!doctype html><html><body></body></html>").window.document;

test("sanitizeEpubSvg strips scripts, handlers, foreignObject, animation, and unsafe urls", () => {
    const dirty = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onclick="alert(1)">
        <script>alert(1)</script>
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
        <animate attributeName="x" to="1" />
        <image href="https://evil.test/a.png" />
        <a href="javascript:alert(1)"></a>
        <path d="M0 0h10v10z" fill="url(#g)" style="fill: expression(alert(1)); color: red" />
        <defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
        <circle cx="5" cy="5" r="4" fill="#0af" />
      </svg>
    `;

    const clean = sanitizeEpubSvg(dirty, doc());
    assert.ok(clean);
    assert.doesNotMatch(
        clean!,
        /script|foreignObject|animate|onclick|javascript:|evil\.test|expression/i
    );
    assert.match(clean!, /<circle/);
    assert.match(clean!, /linearGradient/);
    assert.match(clean!, /path/);
});

test("sanitizeEpubSvg preserves safe local references and shapes", () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
        <defs>
          <linearGradient id="grad">
            <stop offset="0%" stop-color="#fff"/>
            <stop offset="100%" stop-color="#000"/>
          </linearGradient>
        </defs>
        <rect width="20" height="20" fill="url(#grad)" />
        <use href="#grad" />
      </svg>
    `;
    const clean = sanitizeEpubSvg(svg, doc());
    assert.ok(clean);
    assert.match(clean!, /url\(#grad\)/);
    assert.match(clean!, /<rect/);
});
