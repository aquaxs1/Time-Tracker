/**
 * Structural tests for the pages.
 *
 * The popup, options and block pages only really run in a browser. What can
 * be checked without one is the wiring between HTML and JavaScript: every
 * referenced element ID must exist, every referenced file must be on disk.
 * That's exactly where mistakes otherwise surface only once you click.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const PAGES = [
    { html: "popup.html", js: "popup.js" },
    { html: "options.html", js: "options.js" },
    { html: "blocked.html", js: "blocked.js" },
];

function idsIn(html) {
    return new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
}

/** Every ID referenced via getElementById(...) or el(...). */
function referencedIds(js) {
    const ids = new Set();
    for (const match of js.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) ids.add(match[1]);
    for (const match of js.matchAll(/\bel\(\s*["']([^"']+)["']\s*\)/g)) ids.add(match[1]);
    return ids;
}

for (const page of PAGES) {
    test(`${page.js} only references IDs that exist in ${page.html}`, () => {
        const available = idsIn(read(page.html));
        const used = referencedIds(read(page.js));
        assert.ok(used.size > 0, "the test itself must find something");

        for (const id of used) {
            assert.ok(available.has(id), `#${id} is missing from ${page.html}`);
        }
    });

    test(`${page.html} only references files that exist`, () => {
        const html = read(page.html);
        const refs = [
            ...Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), (m) => m[1]),
            ...Array.from(html.matchAll(/<link[^>]+href="([^"]+)"/g), (m) => m[1]),
        ];
        assert.ok(refs.length > 0);
        for (const ref of refs) {
            assert.ok(fs.existsSync(path.join(ROOT, ref)), `${ref} is missing on disk`);
        }
    });
}

test("no scripts load from a third-party server", () => {
    // This is exactly what tripped up the chart in version 1.0: the MV3 CSP
    // blocks anything that doesn't come from the extension itself.
    for (const page of PAGES) {
        const html = read(page.html);
        assert.equal(/<script[^>]+src="https?:/.test(html), false, `${page.html} loads externally`);
        assert.equal(/<link[^>]+href="https?:/.test(html), false, `${page.html} loads externally`);
    }
});

test("each page sets the theme before the stylesheet loads", () => {
    // Without this inline, synchronous script running ahead of the
    // stylesheet, a saved dark-mode preference would flash light for a
    // moment on every open – see lib/theme.js.
    for (const page of PAGES) {
        const html = read(page.html);
        const scriptIndex = html.search(/<script>[\s\S]*?localStorage\.getItem\(\s*["']theme["']/);
        const stylesheetIndex = html.indexOf('<link rel="stylesheet"');
        assert.notEqual(scriptIndex, -1, `${page.html} is missing the pre-paint theme script`);
        assert.ok(scriptIndex < stylesheetIndex, `${page.html} must set the theme before the stylesheet loads`);
    }
});

/* ------------------------------------------------------------------ Manifests */

const MANIFESTS = ["manifest.json", "manifest.firefox.json"];

for (const file of MANIFESTS) {
    test(`${file} is valid and complete`, () => {
        const manifest = JSON.parse(read(file));
        assert.equal(manifest.manifest_version, 3);
        assert.match(manifest.version, /^\d+\.\d+\.\d+$/);

        const files = [
            manifest.action.default_popup,
            manifest.options_ui.page,
            ...Object.values(manifest.icons),
            ...manifest.content_scripts.flatMap((entry) => entry.js),
            ...(manifest.background.service_worker ? [manifest.background.service_worker] : []),
            ...(manifest.background.scripts || []),
        ];
        for (const ref of files) {
            assert.ok(fs.existsSync(path.join(ROOT, ref)), `${ref} is missing (${file})`);
        }
    });
}

test("both manifests describe the same version", () => {
    const chrome = JSON.parse(read("manifest.json"));
    const firefox = JSON.parse(read("manifest.firefox.json"));
    assert.equal(chrome.version, firefox.version);
    assert.equal(chrome.name, firefox.name);
});

test("the Firefox manifest uses background scripts instead of a service worker", () => {
    const firefox = JSON.parse(read("manifest.firefox.json"));
    // Firefox doesn't support background.service_worker in MV3.
    assert.equal(firefox.background.service_worker, undefined);
    assert.deepEqual(firefox.background.scripts, ["background.js"]);
    assert.equal(firefox.background.type, "module");
    assert.ok(firefox.browser_specific_settings.gecko.id);
    // The favicon permission only exists in Chrome.
    assert.equal(firefox.permissions.includes("favicon"), false);
});

/* ---------------------------------------------------------------------- Modules */

test("every imported module exists", () => {
    const sources = [
        "background.js", "popup.js", "options.js", "blocked.js",
        ...fs.readdirSync(path.join(ROOT, "lib")).map((file) => `lib/${file}`),
    ];

    for (const source of sources) {
        const code = read(source);
        const dir = path.dirname(path.join(ROOT, source));
        for (const match of code.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
            const target = path.join(dir, match[1]);
            assert.ok(fs.existsSync(target), `${match[1]} from ${source} is missing`);
        }
    }
});

test("the content script doesn't rely on modules", () => {
    // Content scripts aren't loaded as an ES module; an import would be an error.
    const code = read("content.js");
    assert.equal(/^\s*import\s/m.test(code), false);
});
