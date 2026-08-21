/** Tests for the pure helper modules – no service worker involved. */

import test from "node:test";
import assert from "node:assert/strict";

import { install, makeWorld } from "./mock-chrome.mjs";
install(makeWorld());

const {
    dayKey, dayStart, lastDays, weekKey, splitByDay, formatDuration, formatMinutes, shortDayLabel,
} = await import("../lib/time.js");
const { domainOf, subEntityOf, needsPageLookup, matchesPattern, matchesAny } =
    await import("../lib/entity.js");
const { categoryOf, totalsByCategory, productivityScore, scoreLabel } =
    await import("../lib/categories.js");
const { limitFor, inFocusScope, blockReason } = await import("../lib/limits.js");
const { weekDays, buildReport, reportSummary } = await import("../lib/report.js");
const { toCSV } = await import("../lib/export.js");
const { mergeUsage } = await import("../lib/sync.js");
const { aggregate, aggregateDetail, dailyTotals } = await import("../lib/storage.js");
const { applyTheme } = await import("../lib/theme.js");

/* --------------------------------------------------------------------- time */

test("dayKey and dayStart agree with each other", () => {
    const ts = new Date(2026, 7, 20, 15, 30).getTime();
    assert.equal(dayKey(ts), "2026-08-20");
    assert.equal(dayStart("2026-08-20"), new Date(2026, 7, 20).getTime());
});

test("lastDays returns descending, gapless days", () => {
    const days = lastDays(3, new Date(2026, 7, 20, 10).getTime());
    assert.deepEqual(days, ["2026-08-20", "2026-08-19", "2026-08-18"]);
});

test("lastDays survives a month boundary", () => {
    assert.deepEqual(lastDays(2, new Date(2026, 8, 1, 3).getTime()), ["2026-09-01", "2026-08-31"]);
});

test("weekKey is the same for Monday through Sunday", () => {
    const monday = new Date(2026, 7, 17, 9).getTime();
    const sunday = new Date(2026, 7, 23, 23).getTime();
    assert.equal(weekKey(monday), weekKey(sunday));
    assert.match(weekKey(monday), /^\d{4}-W\d{2}$/);
    // The following Monday belongs to a different week.
    assert.notEqual(weekKey(monday), weekKey(new Date(2026, 7, 24, 9).getTime()));
});

test("splitByDay splits at midnight", () => {
    const start = new Date(2026, 7, 20, 23, 59).getTime();
    assert.deepEqual(splitByDay(start, start + 120000), [
        ["2026-08-20", 60000],
        ["2026-08-21", 60000],
    ]);
});

test("splitByDay leaves same-day segments whole", () => {
    const start = new Date(2026, 7, 20, 10).getTime();
    assert.deepEqual(splitByDay(start, start + 5000), [["2026-08-20", 5000]]);
});

test("duration is formatted without empty units", () => {
    assert.equal(formatDuration(42000), "42 s");
    assert.equal(formatDuration(150000), "2 min 30 s");
    assert.equal(formatDuration(3900000), "1 h 5 min");
    assert.equal(formatDuration(-5), "0 s");
    assert.equal(formatMinutes(3900000), "1 h 5 min");
    assert.equal(formatMinutes(120000), "2 min");
});

test("shortDayLabel names the weekday", () => {
    assert.equal(shortDayLabel("2026-08-20"), "Thu 8/20");
});

/* ------------------------------------------------------------------- entity */

test("domainOf normalizes and filters", () => {
    assert.equal(domainOf("https://www.youtube.com/watch?v=1"), "youtube.com");
    assert.equal(domainOf("http://a.example.com/x"), "a.example.com");
    assert.equal(domainOf("chrome://extensions"), null);
    assert.equal(domainOf("file:///tmp/x.html"), null);
    assert.equal(domainOf("not-a-url-at-all"), null);
    assert.equal(domainOf(undefined), null);
});

test("sub-entities come from the URL where they're present", () => {
    assert.deepEqual(subEntityOf("https://github.com/aquaxs1/Time-Tracker/pull/1"), {
        kind: "Repository", label: "aquaxs1/Time-Tracker",
    });
    assert.deepEqual(subEntityOf("https://reddit.com/r/de/comments/x"), {
        kind: "Subreddit", label: "r/de",
    });
    assert.deepEqual(subEntityOf("https://www.youtube.com/@Kurzgesagt/videos"), {
        kind: "Channel", label: "@Kurzgesagt",
    });
    assert.equal(subEntityOf("https://github.com/settings/profile"), null, "not for system pages");
    assert.equal(subEntityOf("https://example.com/foo"), null, "not for an unknown domain");
});

test("generic section capture only for domains that opt in", () => {
    assert.equal(subEntityOf("https://example.com/blog/x"), null);
    assert.deepEqual(subEntityOf("https://example.com/blog/x", ["example.com"]), {
        kind: "Section", label: "/blog",
    });
});

test("YouTube video pages need the content script", () => {
    assert.equal(needsPageLookup("https://www.youtube.com/watch?v=abc"), true);
    assert.equal(needsPageLookup("https://www.youtube.com/@channel"), false);
    assert.equal(needsPageLookup("https://github.com/x/y"), false);
});

test("patterns match subdomains, but not partial names", () => {
    assert.equal(matchesPattern("a.example.com", "example.com"), true);
    assert.equal(matchesPattern("example.com", "example.com"), true);
    assert.equal(matchesPattern("a.example.com", "*.example.com"), true);
    assert.equal(matchesPattern("notexample.com", "example.com"), false);
    assert.equal(matchesAny("x.internal.company.example", ["other.example", "internal.company.example"]), true);
    assert.equal(matchesAny("example.com", []), false);
});

/* --------------------------------------------------------------- categories */

test("categories come from the default list, overrides win", () => {
    assert.equal(categoryOf("github.com"), "work");
    assert.equal(categoryOf("youtube.com"), "entertainment");
    assert.equal(categoryOf("de.wikipedia.org"), "learning", "subdomain is traced back");
    assert.equal(categoryOf("totally-unknown.xyz"), "other");
    assert.equal(categoryOf("youtube.com", { "youtube.com": "work" }), "work");
    assert.equal(categoryOf("x.company.example", { "company.example": "work" }), "work", "override via subdomain");
});

test("score rises with work and falls with entertainment", () => {
    const work = totalsByCategory([["github.com", 3600000]]);
    const fun = totalsByCategory([["netflix.com", 3600000]]);
    const mixed = totalsByCategory([["github.com", 1800000], ["netflix.com", 1800000]]);

    assert.equal(productivityScore(work), 100);
    assert.equal(productivityScore(fun), 0);
    assert.equal(productivityScore(mixed), 50);
    assert.equal(productivityScore(totalsByCategory([])), null, "no score without data");
    assert.equal(scoreLabel(100), "very productive");
    assert.equal(scoreLabel(null), "");
});

/* ------------------------------------------------------------------- limits */

const limitSettings = {
    limits: { "youtube.com": { minutes: 60, block: true }, "reddit.com": { minutes: 30 } },
    categoryOverrides: {},
    focus: { active: false, until: 0, sites: [] },
};

test("limits also apply to subdomains", () => {
    assert.equal(limitFor("youtube.com", limitSettings).minutes, 60);
    assert.equal(limitFor("m.youtube.com", limitSettings).minutes, 60);
    assert.equal(limitFor("example.com", limitSettings), null);
});

test("blocking only starts at the limit, and only when turned on", () => {
    const base = { settings: limitSettings, now: Date.now() };
    assert.equal(blockReason("youtube.com", { ...base, todayMs: 59 * 60000 }), null);
    assert.equal(blockReason("youtube.com", { ...base, todayMs: 60 * 60000 }), "limit");
    assert.equal(
        blockReason("reddit.com", { ...base, todayMs: 99 * 60000 }),
        null,
        "without the block flag, only a warning",
    );
});

test("snooze temporarily lifts the block", () => {
    const now = Date.now();
    const args = { settings: limitSettings, todayMs: 99 * 60000, now };
    assert.equal(blockReason("youtube.com", { ...args, snoozeUntil: now + 60000 }), null);
    assert.equal(blockReason("youtube.com", { ...args, snoozeUntil: now - 1 }), "limit");
});

test("focus mode blocks categories or a custom list", () => {
    const now = Date.now();
    const focus = {
        ...limitSettings,
        focus: { active: true, until: now + 600000, sites: [] },
    };
    assert.equal(inFocusScope("reddit.com", focus), true, "social is caught by default");
    assert.equal(inFocusScope("github.com", focus), false, "work stays allowed");

    const withList = { ...focus, focus: { ...focus.focus, sites: ["github.com"] } };
    assert.equal(inFocusScope("github.com", withList), true);
    assert.equal(inFocusScope("reddit.com", withList), false, "a custom list replaces the categories");

    const expired = { ...focus, focus: { active: true, until: now - 1, sites: [] } };
    assert.equal(inFocusScope("reddit.com", expired), false, "an expired focus session doesn't block");
});

/* ------------------------------------------------------------------ storage */

test("aggregate sums, sorts and ignores garbage", () => {
    const usage = {
        "2026-08-20": { "a.com": 3000, "b.com": 1000, broken: "text" },
        "2026-08-19": { "b.com": 5000 },
    };
    assert.deepEqual(aggregate(usage), [["b.com", 6000], ["a.com", 3000]]);
    assert.deepEqual(aggregate(usage, ["2026-08-20"]), [["a.com", 3000], ["b.com", 1000]]);
    assert.deepEqual(aggregate({}), []);
    assert.deepEqual(aggregate(undefined), []);
});

test("dailyTotals fills missing days with 0", () => {
    const usage = { "2026-08-20": { "a.com": 1000 } };
    assert.deepEqual(dailyTotals(usage, ["2026-08-20", "2026-08-19"]), {
        "2026-08-20": 1000, "2026-08-19": 0,
    });
});

test("aggregateDetail returns a domain's sub-entities", () => {
    const detail = {
        "2026-08-20": { "youtube.com": { "Channel: A": 1000, "Channel: B": 3000 } },
        "2026-08-19": { "youtube.com": { "Channel: A": 500 } },
    };
    assert.deepEqual(aggregateDetail(detail, "youtube.com"), [["Channel: B", 3000], ["Channel: A", 1500]]);
    assert.deepEqual(aggregateDetail(detail, "other.com"), []);
});

/* ------------------------------------------------------------------- report */

test("weekDays returns Monday through Sunday", () => {
    const days = weekDays(new Date(2026, 7, 20, 12).getTime()); // a Thursday
    assert.equal(days.length, 7);
    assert.equal(days[0], "2026-08-17", "starts on Monday");
    assert.equal(days[6], "2026-08-23", "ends on Sunday");
});

test("the report compares against the previous week", () => {
    const usage = {
        "2026-08-18": { "github.com": 3600000 },
        "2026-08-19": { "netflix.com": 1800000 },
        "2026-08-12": { "github.com": 1800000 },
    };
    const report = buildReport(usage, { categoryOverrides: {} }, new Date(2026, 7, 20, 12).getTime());

    assert.equal(report.totalMs, 5400000);
    assert.equal(report.previousMs, 1800000);
    assert.equal(report.activeDays, 2);
    assert.deepEqual(report.top[0], ["github.com", 3600000]);
    assert.equal(report.score, 67, "two thirds work");
    assert.match(reportSummary(report), /\+200% vs\. last week/);
});

/* ------------------------------------------------------------------- export */

test("CSV escapes special characters and converts units", () => {
    const csv = toCSV({ "2026-08-20": { "a.com": 3600000, 'b",x.com': 60000 } });
    const lines = csv.split("\r\n");
    assert.match(lines[0], /Date,Domain,Seconds,Minutes,Hours$/);
    assert.equal(lines[1], "2026-08-20,a.com,3600,60.00,1.000");
    assert.equal(lines[2], '2026-08-20,"b"",x.com",60,1.00,0.017');
});

/* --------------------------------------------------------------------- sync */

test("mergeUsage adds devices together without losing days", () => {
    const local = { "2026-08-20": { "a.com": 1000 } };
    const remote = { "2026-08-20": { "a.com": 500, "b.com": 200 }, "2026-08-19": { "a.com": 300 } };
    assert.deepEqual(mergeUsage(local, remote), {
        "2026-08-20": { "a.com": 1500, "b.com": 200 },
        "2026-08-19": { "a.com": 300 },
    });
});

/* -------------------------------------------------------------------- theme */

/** Minimal document/localStorage stand-in, just enough for applyTheme(). */
function stubDom() {
    const root = { dataset: {} };
    globalThis.document = { documentElement: root };
    const store = new Map();
    globalThis.localStorage = {
        setItem: (k, v) => store.set(k, v),
        getItem: (k) => (store.has(k) ? store.get(k) : null),
    };
    return { root, store };
}

test("applyTheme sets and clears the data-theme attribute", () => {
    const { root, store } = stubDom();

    applyTheme("dark");
    assert.equal(root.dataset.theme, "dark");
    assert.equal(store.get("theme"), "dark");

    applyTheme("light");
    assert.equal(root.dataset.theme, "light");
    assert.equal(store.get("theme"), "light");

    applyTheme("auto");
    assert.equal(root.dataset.theme, undefined, "auto removes the attribute, letting the OS decide");
    assert.equal(store.get("theme"), "auto");
});

test("applyTheme survives a localStorage that throws", () => {
    const { root } = stubDom();
    globalThis.localStorage = {
        setItem: () => { throw new Error("blocked in private browsing"); },
        getItem: () => null,
    };
    assert.doesNotThrow(() => applyTheme("dark"));
    assert.equal(root.dataset.theme, "dark", "the attribute is still set even if storage fails");
});
