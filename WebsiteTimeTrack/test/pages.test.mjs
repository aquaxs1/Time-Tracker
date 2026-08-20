/**
 * Strukturtests der Seiten.
 *
 * Popup, Optionen und Sperrseite laufen nur im Browser. Was sich ohne Browser
 * pruefen laesst, ist der Bezug zwischen HTML und JavaScript: jede angesprochene
 * Element-ID muss es geben, jede referenzierte Datei muss existieren. Genau da
 * sitzen die Fehler, die sonst erst beim Klicken auffallen.
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

/** Alle per getElementById(...) oder el(...) angesprochenen IDs. */
function referencedIds(js) {
    const ids = new Set();
    for (const match of js.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) ids.add(match[1]);
    for (const match of js.matchAll(/\bel\(\s*["']([^"']+)["']\s*\)/g)) ids.add(match[1]);
    return ids;
}

for (const page of PAGES) {
    test(`${page.js} spricht nur IDs an, die es in ${page.html} gibt`, () => {
        const available = idsIn(read(page.html));
        const used = referencedIds(read(page.js));
        assert.ok(used.size > 0, "der Test selbst muss etwas finden");

        for (const id of used) {
            assert.ok(available.has(id), `#${id} fehlt in ${page.html}`);
        }
    });

    test(`${page.html} referenziert nur vorhandene Dateien`, () => {
        const html = read(page.html);
        const refs = [
            ...Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), (m) => m[1]),
            ...Array.from(html.matchAll(/<link[^>]+href="([^"]+)"/g), (m) => m[1]),
        ];
        assert.ok(refs.length > 0);
        for (const ref of refs) {
            assert.ok(fs.existsSync(path.join(ROOT, ref)), `${ref} fehlt auf der Platte`);
        }
    });
}

test("keine Skripte von fremden Servern", () => {
    // Genau daran ist das Diagramm in Version 1.0 gescheitert: die MV3-CSP
    // blockt alles, was nicht aus der Extension selbst kommt.
    for (const page of PAGES) {
        const html = read(page.html);
        assert.equal(/<script[^>]+src="https?:/.test(html), false, `${page.html} laedt extern`);
        assert.equal(/<link[^>]+href="https?:/.test(html), false, `${page.html} laedt extern`);
    }
});

/* ---------------------------------------------------------------- Manifeste */

const MANIFESTS = ["manifest.json", "manifest.firefox.json"];

for (const file of MANIFESTS) {
    test(`${file} ist gueltig und vollstaendig`, () => {
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
            assert.ok(fs.existsSync(path.join(ROOT, ref)), `${ref} fehlt (${file})`);
        }
    });
}

test("beide Manifeste beschreiben dieselbe Version", () => {
    const chrome = JSON.parse(read("manifest.json"));
    const firefox = JSON.parse(read("manifest.firefox.json"));
    assert.equal(chrome.version, firefox.version);
    assert.equal(chrome.name, firefox.name);
});

test("Firefox-Manifest nutzt Hintergrundskripte statt Service Worker", () => {
    const firefox = JSON.parse(read("manifest.firefox.json"));
    // Firefox unterstuetzt background.service_worker in MV3 nicht.
    assert.equal(firefox.background.service_worker, undefined);
    assert.deepEqual(firefox.background.scripts, ["background.js"]);
    assert.equal(firefox.background.type, "module");
    assert.ok(firefox.browser_specific_settings.gecko.id);
    // Die favicon-Berechtigung gibt es nur in Chrome.
    assert.equal(firefox.permissions.includes("favicon"), false);
});

/* ------------------------------------------------------------------ Module */

test("alle importierten Module existieren", () => {
    const sources = [
        "background.js", "popup.js", "options.js", "blocked.js",
        ...fs.readdirSync(path.join(ROOT, "lib")).map((file) => `lib/${file}`),
    ];

    for (const source of sources) {
        const code = read(source);
        const dir = path.dirname(path.join(ROOT, source));
        for (const match of code.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
            const target = path.join(dir, match[1]);
            assert.ok(fs.existsSync(target), `${match[1]} aus ${source} fehlt`);
        }
    }
});

test("das Content-Script kommt ohne Module aus", () => {
    // Content-Scripts werden nicht als ES-Modul geladen; ein import waere ein Fehler.
    const code = read("content.js");
    assert.equal(/^\s*import\s/m.test(code), false);
});
