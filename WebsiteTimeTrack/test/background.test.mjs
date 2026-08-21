/**
 * Integration tests for the service worker against the Chrome mock.
 * Every test boots the worker fresh – as if after an idle shutdown.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { install, makeWorld, fire, settleQueue, sendMessage, totalFor } from "./mock-chrome.mjs";

const SRC = pathToFileURL(
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", "background.js"),
).href;

let now = new Date(2026, 7, 20, 10, 0, 0).getTime();
Date.now = () => now;
const tick = (ms) => (now += ms);

let loadCounter = 0;

/**
 * Boots the service worker with fresh state.
 * The query parameter dodges the ES module cache – without it the module
 * body wouldn't run a second time and no listeners would register.
 */
async function boot(world) {
    const chrome = install(world);
    await import(`${SRC}?v=${loadCounter++}`);
    await settleQueue();
    return chrome;
}

/** A world with one active tab on `url`. */
function worldWith(url, extra = {}) {
    return makeWorld({
        tabs: [{ id: 1, url, active: true, windowId: 1, audible: false }],
        ...extra,
    });
}

/** Stores settings the way getSettings() reads them. */
function withSettings(world, settings) {
    world.sync.settings = settings;
    return world;
}

const alarm = (chrome) => fire(chrome, "alarm", { name: "flush" });

/* --------------------------------------------------------------- Baseline */

test("the active tab is captured the moment the worker starts", async () => {
    const world = worldWith("https://www.youtube.com/watch?v=1");
    const chrome = await boot(world);

    assert.equal(world.session.active.domain, "youtube.com", "www. is stripped");

    tick(30_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "youtube.com"), 30_000);
});

test("idle stops the measurement, and coming back starts it again", async () => {
    const world = worldWith("https://github.com/x/y");
    const chrome = await boot(world);

    // Chrome only reports the idle state after the threshold (60 s) has
    // elapsed. The user was already inactive for a minute – only the 10 s
    // before that should count.
    tick(70_000);
    world.idleState = "idle";
    await fire(chrome, "idle", "idle");
    assert.equal(totalFor(world.local, "github.com"), 10_000, "idle threshold subtracted");

    tick(600_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "github.com"), 10_000, "idle time doesn't count");

    world.idleState = "active";
    await fire(chrome, "idle", "active");
    tick(5_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "github.com"), 15_000, "active again afterwards");
});

test("the clock doesn't run without a focused window", async () => {
    const world = worldWith("https://news.ycombinator.com/");
    const chrome = await boot(world);

    tick(8_000);
    world.windowFocused = false;
    await fire(chrome, "focus", -1);

    tick(120_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "news.ycombinator.com"), 8_000);
});

test("switching tabs books time to the right domain each time", async () => {
    const world = worldWith("https://a.example/");
    const chrome = await boot(world);

    tick(4_000);
    world.tabs = [{ id: 2, url: "https://b.example/", active: true, windowId: 1 }];
    await fire(chrome, "tabActivated", { tabId: 2 });

    tick(6_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "a.example"), 4_000);
    assert.equal(totalFor(world.local, "b.example"), 6_000);
});

test("chrome:// and tabs without a URL don't crash anything", async () => {
    const world = worldWith("chrome://extensions");
    const chrome = await boot(world);

    tick(5_000);
    await alarm(chrome);
    assert.equal(world.local.usage, undefined, "nothing booked");

    world.tabs = [{ id: 3, url: undefined, active: true, windowId: 1 }];
    await fire(chrome, "tabActivated", { tabId: 3 });
    tick(5_000);
    await alarm(chrome);
});

test("standby never creates fictional time", async () => {
    const world = worldWith("https://sleep.example/");
    const chrome = await boot(world);

    tick(8 * 60 * 60 * 1000); // laptop closed, no event fired
    await alarm(chrome);
    assert.equal(totalFor(world.local, "sleep.example"), 0);
});

test("segments crossing midnight land on both days", async () => {
    now = new Date(2026, 7, 20, 23, 59).getTime();
    const world = worldWith("https://late.example/");
    const chrome = await boot(world);

    tick(120_000);
    await alarm(chrome);
    assert.equal(world.local.usage["2026-08-20"]["late.example"], 60_000);
    assert.equal(world.local.usage["2026-08-21"]["late.example"], 60_000);

    now = new Date(2026, 7, 20, 10).getTime();
});

/* -------------------------------------------------------------- Ignore list */

test("ignored domains are never captured at all", async () => {
    const world = withSettings(worldWith("https://internal.company.example/x"), {
        ignore: ["company.example"],
    });
    const chrome = await boot(world);

    tick(30_000);
    await alarm(chrome);
    assert.equal(world.local.usage, undefined);
    assert.equal(world.session.active, null);
});

/* --------------------------------------------------------------- Interaction */

test("an open tab doesn't count without interaction", async () => {
    const world = withSettings(worldWith("https://video.example/"), {
        requireInteraction: true,
        interactionTimeoutSeconds: 90,
    });
    const chrome = await boot(world);

    assert.equal(world.session.active, null, "no interaction reported yet");

    await sendMessage(chrome, { type: "interaction" }, { tab: { id: 1 } });
    await settleQueue();
    assert.equal(world.session.active.domain, "video.example", "counts once interaction happens");

    tick(20_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "video.example"), 20_000);

    // Without another interaction, usage ends with the 90-second window –
    // not only once the next alarm notices.
    tick(200_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "video.example"), 90_000, "capped at the window");

    tick(200_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "video.example"), 90_000, "nothing further after that");
});

test("tabs with audio count even without interaction", async () => {
    const world = withSettings(
        makeWorld({
            tabs: [{ id: 1, url: "https://video.example/", active: true, windowId: 1, audible: true }],
        }),
        { requireInteraction: true, audibleCountsAsActive: true },
    );
    const chrome = await boot(world);

    tick(30_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "video.example"), 30_000);
});

/* ------------------------------------------------------------------ Sub-entities */

test("a GitHub repo is captured from the URL", async () => {
    const world = worldWith("https://github.com/aquaxs1/Time-Tracker/pull/1");
    const chrome = await boot(world);

    tick(30_000);
    await alarm(chrome);
    assert.equal(
        world.local.detail["2026-08-20"]["github.com"]["Repository: aquaxs1/Time-Tracker"],
        30_000,
    );
});

test("a YouTube channel comes from the content script", async () => {
    const world = worldWith("https://www.youtube.com/watch?v=abc");
    const chrome = await boot(world);

    tick(10_000);
    await sendMessage(chrome, { type: "entity", label: "Kurzgesagt" }, { tab: { id: 1 } });
    await settleQueue();

    tick(20_000);
    await alarm(chrome);

    const detail = world.local.detail["2026-08-20"]["youtube.com"];
    assert.equal(detail["Channel: Kurzgesagt"], 20_000);
    assert.equal(totalFor(world.local, "youtube.com"), 30_000, "the domain counts the whole time");
});

test("navigating drops the previous video's channel name", async () => {
    const world = worldWith("https://www.youtube.com/watch?v=abc");
    const chrome = await boot(world);

    await sendMessage(chrome, { type: "entity", label: "Channel A" }, { tab: { id: 1 } });
    await settleQueue();

    world.tabs[0].url = "https://www.youtube.com/watch?v=xyz";
    await fire(chrome, "tabUpdated", 1, { url: world.tabs[0].url }, world.tabs[0]);

    tick(20_000);
    await alarm(chrome);
    const detail = ((world.local.detail || {})["2026-08-20"] || {})["youtube.com"] || {};
    assert.equal(detail["Channel: Channel A"], undefined, "the old channel stops accruing time");
    assert.equal(totalFor(world.local, "youtube.com"), 20_000, "the domain keeps counting");
});

/* ------------------------------------------------------------------------ Limits */

test("a warning at 80 percent, a notification at 100 percent", async () => {
    const world = withSettings(worldWith("https://youtube.com/feed"), {
        limits: { "youtube.com": { minutes: 10, block: false } },
        notifyAtPercent: 80,
    });
    // 8 of 10 minutes are already used up.
    world.local.usage = { "2026-08-20": { "youtube.com": 8 * 60000 } };
    const chrome = await boot(world);

    await alarm(chrome);
    assert.equal(world.notifications.length, 1, "one warning");
    assert.match(world.notifications[0].title, /Almost at the limit/);

    await alarm(chrome);
    assert.equal(world.notifications.length, 1, "no duplicate warning");

    world.local.usage["2026-08-20"]["youtube.com"] = 10 * 60000;
    await alarm(chrome);
    assert.equal(world.notifications.length, 2);
    assert.match(world.notifications[1].title, /Limit reached/);
});

test("a reached limit blocks the tab, snooze frees it up", async () => {
    const world = withSettings(worldWith("https://reddit.com/r/de"), {
        limits: { "reddit.com": { minutes: 5, block: true } },
    });
    world.local.usage = { "2026-08-20": { "reddit.com": 6 * 60000 } };
    const chrome = await boot(world);

    await alarm(chrome);
    assert.equal(world.updated.length, 1, "the tab was redirected");
    assert.match(world.updated[0].url, /blocked\.html\?d=reddit\.com/);
    assert.match(world.updated[0].url, /r=limit/);

    // Request an exception and go back to the page.
    const response = await sendMessage(chrome, { type: "snooze", domain: "reddit.com" });
    assert.equal(response.ok, true);

    world.tabs[0].url = "https://reddit.com/r/de";
    world.updated.length = 0;
    await alarm(chrome);
    assert.equal(world.updated.length, 0, "no block during the snooze");

    tick(6 * 60 * 1000); // snooze expired
    await alarm(chrome);
    assert.equal(world.updated.length, 1, "blocked again afterwards");
});

test("focus mode blocks distraction, lets work through", async () => {
    const world = withSettings(
        makeWorld({
            tabs: [
                { id: 1, url: "https://instagram.com/", active: true, windowId: 1 },
                { id: 2, url: "https://github.com/x/y", active: false, windowId: 1 },
            ],
        }),
        { focus: { active: true, until: now + 3600000, sites: [] } },
    );
    const chrome = await boot(world);

    await alarm(chrome);
    assert.equal(world.updated.length, 1);
    assert.equal(world.updated[0].tabId, 1, "only the social tab");
    assert.match(world.updated[0].url, /r=focus/);
});

test("expired focus mode no longer blocks", async () => {
    const world = withSettings(worldWith("https://instagram.com/"), {
        focus: { active: true, until: now - 1000, sites: [] },
    });
    const chrome = await boot(world);

    await alarm(chrome);
    assert.equal(world.updated.length, 0);
});

/* --------------------------------------------------------------------- Maintenance */

test("the weekly report is created once per week", async () => {
    const world = withSettings(worldWith("https://example.com/"), { weeklyReport: true });
    // Fill the previous week with data (Mon 8/10 through Sun 8/16, 2026).
    world.local.usage = {
        "2026-08-11": { "github.com": 3600000 },
        "2026-08-13": { "netflix.com": 1800000 },
    };
    const chrome = await boot(world);

    await fire(chrome, "alarm", { name: "maintenance" });
    assert.equal(world.local.reports.length, 1);
    assert.equal(world.local.reports[0].totalMs, 5400000);

    const notifications = world.notifications.filter((n) => n.id.startsWith("report-"));
    assert.equal(notifications.length, 1);

    await fire(chrome, "alarm", { name: "maintenance" });
    assert.equal(world.local.reports.length, 1, "no second report for the same week");
});

test("old days get cleaned up", async () => {
    const world = worldWith("https://example.com/");
    world.local.usage = {
        "2026-08-19": { "a.com": 1000 },
        "2024-01-01": { "old.com": 1000 },
    };
    const chrome = await boot(world);

    await fire(chrome, "alarm", { name: "maintenance" });
    assert.ok(world.local.usage["2026-08-19"], "recent days stay");
    assert.equal(world.local.usage["2024-01-01"], undefined, "old days are dropped");
});

/* --------------------------------------------------------------------- Migration */

test("data from version 1.0 is carried over", async () => {
    const world = worldWith("https://new.example/");
    world.local = { "youtube.com": 3600, "old.example": 90, notanumber: "x" };
    const chrome = await boot(world);

    await fire(chrome, "installed");
    await settleQueue();

    assert.equal(world.local.usage["2026-08-20"]["youtube.com"], 3_600_000, "seconds to ms");
    assert.equal(world.local.usage["2026-08-20"]["old.example"], 90_000);
    assert.equal(world.local["youtube.com"], undefined, "old keys removed");
    assert.equal(world.local.notanumber, "x", "unrelated keys are left alone");
    assert.equal(world.local.meta.schema, 3);
});

/* ---------------------------------------------------------------------- Messages */

test("the popup forces a flush of running time", async () => {
    const world = worldWith("https://msg.example/");
    const chrome = await boot(world);

    tick(3_000);
    const response = await sendMessage(chrome, { type: "sync" });
    assert.deepEqual(response, { ok: true });
    assert.equal(totalFor(world.local, "msg.example"), 3_000);
});

test("changed settings take effect immediately", async () => {
    const world = worldWith("https://instagram.com/");
    const chrome = await boot(world);

    tick(5_000);
    await alarm(chrome);
    assert.equal(world.updated.length, 0);

    // Turn on focus mode, the way the options page does.
    world.sync.settings = { focus: { active: true, until: now + 600000, sites: [] } };
    await sendMessage(chrome, { type: "settingsChanged" });
    await settleQueue();

    assert.equal(world.updated.length, 1, "the block applies without a restart");
});

test("unknown messages get no reply", async () => {
    const world = worldWith("https://example.com/");
    const chrome = await boot(world);
    assert.equal(await sendMessage(chrome, { type: "doesNotExist" }), undefined);
});
