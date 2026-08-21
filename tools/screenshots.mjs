/**
 * Generates the website's screenshots from the real extension.
 *
 * The extension's pages are loaded through a local server (ES modules need
 * http, file:// blocks them) and the chrome.* APIs are replaced with a stub
 * holding sample data before anything loads. What ends up on the website is
 * exactly what popup.html and friends render – not a hand-built mockup.
 *
 * Dark mode is forced explicitly (the "dark" theme setting, not just the
 * OS preference) so the screenshots are reproducible regardless of which
 * system this runs on.
 *
 *   node tools/screenshots.mjs
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "WebsiteTimeTrack");
const OUT = path.join(ROOT, "site", "assets");

// Use the pre-installed Chromium if present, otherwise Playwright's own.
const PINNED_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CHROME = fs.existsSync(PINNED_CHROME) ? PINNED_CHROME : undefined;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".json": "application/json",
};

function serve(dir) {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        const file = path.join(dir, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""));
        if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404).end("not found");
            return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

/** Runs in the browser before the page's own scripts start. */
function stubChrome() {
    // Force dark mode from the very first paint, same mechanism the real
    // pre-paint script in each <head> uses.
    try {
        localStorage.setItem("theme", "dark");
    } catch {
        // Ignored – the explicit "dark" setting below still wins once JS runs.
    }

    const day = (offset) => {
        const d = new Date(Date.now() - offset * 86400000);
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const min = (n) => n * 60000;

    const usage = {
        [day(0)]: {
            "github.com": min(97), "youtube.com": min(63), "stackoverflow.com": min(41),
            "figma.com": min(28), "reddit.com": min(22), "news.ycombinator.com": min(14),
            "docs.google.com": min(11), "bbc.com": min(6),
        },
    };
    // History: 30 days with plausible spread, weaker on weekends.
    const seeds = [83, 51, 44, 92, 67, 71, 38, 25, 88, 74, 61, 95, 57, 46, 33,
                   21, 79, 86, 64, 53, 91, 48, 36, 27, 82, 69, 58, 94, 42, 31];
    for (let i = 1; i < 30; i++) {
        const weekend = [0, 6].includes(new Date(Date.now() - i * 86400000).getDay());
        const scale = weekend ? 0.45 : 1;
        usage[day(i)] = {
            "github.com": min(Math.round(seeds[i] * 1.1 * scale)),
            "youtube.com": min(Math.round(seeds[(i + 7) % 30] * 0.8 * scale)),
            "stackoverflow.com": min(Math.round(seeds[(i + 13) % 30] * 0.5 * scale)),
            "reddit.com": min(Math.round(seeds[(i + 3) % 30] * 0.4 * scale)),
        };
    }

    const local = {
        usage,
        detail: {
            [day(0)]: {
                "youtube.com": {
                    "Channel: Kurzgesagt": min(24), "Channel: Fireship": min(19),
                    "Channel: Veritasium": min(13),
                },
                "github.com": {
                    "Repository: aquaxs1/Time-Tracker": min(52),
                    "Repository: microsoft/vscode": min(23), "Repository: nodejs/node": min(12),
                },
            },
        },
        meta: { schema: 3, deviceId: "dev-demo" },
        reports: [{
            week: "2026-W33", generatedAt: Date.now(), days: [], perDay: {},
            totalMs: min(1284), previousMs: min(1102), activeDays: 6,
            top: [["github.com", min(497)], ["youtube.com", min(288)],
                  ["stackoverflow.com", min(191)], ["figma.com", min(142)],
                  ["reddit.com", min(97)]],
            categories: {}, score: 63,
        }],
    };

    const sync = {
        settings: {
            theme: "dark",
            limits: {
                "youtube.com": { minutes: 60, block: true },
                "reddit.com": { minutes: 30, block: false },
            },
            categoryOverrides: { "figma.com": "work" },
            ignore: ["internal.company.example"],
        },
    };

    const area = (store) => ({
        async get(keys) {
            if (keys === null || keys === undefined) return { ...store };
            if (typeof keys === "string") return keys in store ? { [keys]: store[keys] } : {};
            const out = {};
            for (const key of keys) if (key in store) out[key] = store[key];
            return out;
        },
        async set(obj) { Object.assign(store, obj); },
        async remove() {},
    });

    globalThis.chrome = {
        storage: {
            local: area(local), sync: area(sync), session: area({}),
            onChanged: { addListener() {} },
        },
        runtime: {
            lastError: null,
            getURL: (p) => `/${String(p).replace(/^\//, "")}`,
            sendMessage: (_message, callback) => { if (callback) callback({ ok: true }); },
            openOptionsPage() {},
            onMessage: { addListener() {} },
        },
    };
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const server = await serve(EXT);
    const base = `http://127.0.0.1:${server.address().port}`;

    const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
    const context = await browser.newContext({ deviceScaleFactor: 2, colorScheme: "dark" });
    await context.addInitScript(stubChrome);

    const shots = [];

    /* ------------------------------------------------------------- Popup */
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 640 });
    await popup.goto(`${base}/popup.html`);
    await popup.waitForSelector(".site", { timeout: 10000 });
    await popup.waitForTimeout(400);

    /** Crops to the actual content height – like the real popup does. */
    async function shootPopup(name) {
        const height = await popup.evaluate(() => Math.ceil(document.body.scrollHeight));
        await popup.setViewportSize({ width: 360, height });
        await popup.waitForTimeout(150);
        await popup.screenshot({ path: path.join(OUT, name) });
        shots.push(name);
    }

    await shootPopup("popup-sites.png");

    // Expand sub-entities – shows the channel/repo breakdown.
    await popup.click(".site:nth-child(2) .site-row");
    await popup.waitForTimeout(300);
    await shootPopup("popup-detail.png");

    await popup.click('[data-view="history"]');
    await popup.waitForTimeout(400);
    await shootPopup("popup-history.png");

    await popup.click('[data-view="categories"]');
    await popup.waitForTimeout(400);
    await shootPopup("popup-categories.png");

    /* ----------------------------------------------------------- Options */
    const options = await context.newPage();
    await options.setViewportSize({ width: 760, height: 900 });
    await options.goto(`${base}/options.html`);
    await options.waitForTimeout(800);
    await options.screenshot({ path: path.join(OUT, "options.png") });
    shots.push("options.png");

    /* ------------------------------------------------------------ Block page */
    const blocked = await context.newPage();
    await blocked.setViewportSize({ width: 660, height: 460 });
    await blocked.goto(`${base}/blocked.html?d=youtube.com&r=limit&u=https://youtube.com/`);
    await blocked.waitForTimeout(600);
    // Just the card, not the empty space around it – or it gets lost in the
    // website's screenshot gallery.
    await blocked.locator(".block-card").screenshot({ path: path.join(OUT, "blocked.png") });
    shots.push("blocked.png");

    await browser.close();
    server.close();

    for (const shot of shots) {
        const { size } = fs.statSync(path.join(OUT, shot));
        console.log(`${shot.padEnd(24)} ${(size / 1024).toFixed(0)} KB`);
    }
}

main();
