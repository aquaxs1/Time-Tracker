/** Tests der reinen Hilfsmodule – ohne Service Worker. */

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

/* --------------------------------------------------------------------- time */

test("dayKey und dayStart passen zusammen", () => {
    const ts = new Date(2026, 7, 20, 15, 30).getTime();
    assert.equal(dayKey(ts), "2026-08-20");
    assert.equal(dayStart("2026-08-20"), new Date(2026, 7, 20).getTime());
});

test("lastDays liefert absteigende, lueckenlose Tage", () => {
    const days = lastDays(3, new Date(2026, 7, 20, 10).getTime());
    assert.deepEqual(days, ["2026-08-20", "2026-08-19", "2026-08-18"]);
});

test("lastDays ueberlebt einen Monatswechsel", () => {
    assert.deepEqual(lastDays(2, new Date(2026, 8, 1, 3).getTime()), ["2026-09-01", "2026-08-31"]);
});

test("weekKey ist fuer Montag bis Sonntag derselbe", () => {
    const monday = new Date(2026, 7, 17, 9).getTime();
    const sunday = new Date(2026, 7, 23, 23).getTime();
    assert.equal(weekKey(monday), weekKey(sunday));
    assert.match(weekKey(monday), /^\d{4}-W\d{2}$/);
    // Der Montag danach gehoert in eine andere Woche.
    assert.notEqual(weekKey(monday), weekKey(new Date(2026, 7, 24, 9).getTime()));
});

test("splitByDay trennt an Mitternacht", () => {
    const start = new Date(2026, 7, 20, 23, 59).getTime();
    assert.deepEqual(splitByDay(start, start + 120000), [
        ["2026-08-20", 60000],
        ["2026-08-21", 60000],
    ]);
});

test("splitByDay laesst Segmente innerhalb eines Tages ganz", () => {
    const start = new Date(2026, 7, 20, 10).getTime();
    assert.deepEqual(splitByDay(start, start + 5000), [["2026-08-20", 5000]]);
});

test("Dauer wird ohne leere Einheiten formatiert", () => {
    assert.equal(formatDuration(42000), "42 s");
    assert.equal(formatDuration(150000), "2 min 30 s");
    assert.equal(formatDuration(3900000), "1 h 5 min");
    assert.equal(formatDuration(-5), "0 s");
    assert.equal(formatMinutes(3900000), "1 h 5 min");
    assert.equal(formatMinutes(120000), "2 min");
});

test("shortDayLabel nennt den Wochentag", () => {
    assert.equal(shortDayLabel("2026-08-20"), "Do 20.8.");
});

/* ------------------------------------------------------------------- entity */

test("domainOf normalisiert und filtert", () => {
    assert.equal(domainOf("https://www.youtube.com/watch?v=1"), "youtube.com");
    assert.equal(domainOf("http://a.example.com/x"), "a.example.com");
    assert.equal(domainOf("chrome://extensions"), null);
    assert.equal(domainOf("file:///tmp/x.html"), null);
    assert.equal(domainOf("nicht-mal-eine-url"), null);
    assert.equal(domainOf(undefined), null);
});

test("Unterobjekte kommen aus der URL, wo sie drinstehen", () => {
    assert.deepEqual(subEntityOf("https://github.com/aquaxs1/Time-Tracker/pull/1"), {
        kind: "Repo", label: "aquaxs1/Time-Tracker",
    });
    assert.deepEqual(subEntityOf("https://reddit.com/r/de/comments/x"), {
        kind: "Subreddit", label: "r/de",
    });
    assert.deepEqual(subEntityOf("https://www.youtube.com/@Kurzgesagt/videos"), {
        kind: "Kanal", label: "@Kurzgesagt",
    });
    assert.equal(subEntityOf("https://github.com/settings/profile"), null, "Systemseiten nicht");
    assert.equal(subEntityOf("https://example.com/foo"), null, "unbekannte Domain nicht");
});

test("generische Bereichs-Erfassung nur fuer gewaehlte Domains", () => {
    assert.equal(subEntityOf("https://example.com/blog/x"), null);
    assert.deepEqual(subEntityOf("https://example.com/blog/x", ["example.com"]), {
        kind: "Bereich", label: "/blog",
    });
});

test("YouTube-Videoseiten brauchen das Content-Script", () => {
    assert.equal(needsPageLookup("https://www.youtube.com/watch?v=abc"), true);
    assert.equal(needsPageLookup("https://www.youtube.com/@Kanal"), false);
    assert.equal(needsPageLookup("https://github.com/x/y"), false);
});

test("Muster treffen Subdomains, aber keine Namensteile", () => {
    assert.equal(matchesPattern("a.example.com", "example.com"), true);
    assert.equal(matchesPattern("example.com", "example.com"), true);
    assert.equal(matchesPattern("a.example.com", "*.example.com"), true);
    assert.equal(matchesPattern("notexample.com", "example.com"), false);
    assert.equal(matchesAny("x.intern.firma.de", ["andere.de", "intern.firma.de"]), true);
    assert.equal(matchesAny("example.com", []), false);
});

/* --------------------------------------------------------------- categories */

test("Kategorien kommen aus Standardliste, Overrides stechen sie aus", () => {
    assert.equal(categoryOf("github.com"), "work");
    assert.equal(categoryOf("youtube.com"), "entertainment");
    assert.equal(categoryOf("de.wikipedia.org"), "learning", "Subdomain wird zurueckgefuehrt");
    assert.equal(categoryOf("voellig-unbekannt.xyz"), "other");
    assert.equal(categoryOf("youtube.com", { "youtube.com": "work" }), "work");
    assert.equal(categoryOf("x.firma.de", { "firma.de": "work" }), "work", "Override per Subdomain");
});

test("Score steigt mit Arbeit und faellt mit Unterhaltung", () => {
    const work = totalsByCategory([["github.com", 3600000]]);
    const fun = totalsByCategory([["netflix.com", 3600000]]);
    const mixed = totalsByCategory([["github.com", 1800000], ["netflix.com", 1800000]]);

    assert.equal(productivityScore(work), 100);
    assert.equal(productivityScore(fun), 0);
    assert.equal(productivityScore(mixed), 50);
    assert.equal(productivityScore(totalsByCategory([])), null, "ohne Daten kein Score");
    assert.equal(scoreLabel(100), "sehr produktiv");
    assert.equal(scoreLabel(null), "");
});

/* ------------------------------------------------------------------- limits */

const limitSettings = {
    limits: { "youtube.com": { minutes: 60, block: true }, "reddit.com": { minutes: 30 } },
    categoryOverrides: {},
    focus: { active: false, until: 0, sites: [] },
};

test("Limits greifen auch auf Subdomains", () => {
    assert.equal(limitFor("youtube.com", limitSettings).minutes, 60);
    assert.equal(limitFor("m.youtube.com", limitSettings).minutes, 60);
    assert.equal(limitFor("example.com", limitSettings), null);
});

test("Sperre erst ab dem Limit und nur wenn eingeschaltet", () => {
    const base = { settings: limitSettings, now: Date.now() };
    assert.equal(blockReason("youtube.com", { ...base, todayMs: 59 * 60000 }), null);
    assert.equal(blockReason("youtube.com", { ...base, todayMs: 60 * 60000 }), "limit");
    assert.equal(
        blockReason("reddit.com", { ...base, todayMs: 99 * 60000 }),
        null,
        "ohne block-Flag nur Warnung",
    );
});

test("Snooze hebt die Sperre voruebergehend auf", () => {
    const now = Date.now();
    const args = { settings: limitSettings, todayMs: 99 * 60000, now };
    assert.equal(blockReason("youtube.com", { ...args, snoozeUntil: now + 60000 }), null);
    assert.equal(blockReason("youtube.com", { ...args, snoozeUntil: now - 1 }), "limit");
});

test("Fokusmodus sperrt Kategorien oder eine eigene Liste", () => {
    const now = Date.now();
    const focus = {
        ...limitSettings,
        focus: { active: true, until: now + 600000, sites: [] },
    };
    assert.equal(inFocusScope("reddit.com", focus), true, "social greift per Standard");
    assert.equal(inFocusScope("github.com", focus), false, "Arbeit bleibt erlaubt");

    const withList = { ...focus, focus: { ...focus.focus, sites: ["github.com"] } };
    assert.equal(inFocusScope("github.com", withList), true);
    assert.equal(inFocusScope("reddit.com", withList), false, "eigene Liste ersetzt die Kategorien");

    const expired = { ...focus, focus: { active: true, until: now - 1, sites: [] } };
    assert.equal(inFocusScope("reddit.com", expired), false, "abgelaufener Fokus sperrt nicht");
});

/* ------------------------------------------------------------------ storage */

test("aggregate summiert, sortiert und ignoriert Muell", () => {
    const usage = {
        "2026-08-20": { "a.com": 3000, "b.com": 1000, kaputt: "text" },
        "2026-08-19": { "b.com": 5000 },
    };
    assert.deepEqual(aggregate(usage), [["b.com", 6000], ["a.com", 3000]]);
    assert.deepEqual(aggregate(usage, ["2026-08-20"]), [["a.com", 3000], ["b.com", 1000]]);
    assert.deepEqual(aggregate({}), []);
    assert.deepEqual(aggregate(undefined), []);
});

test("dailyTotals fuellt fehlende Tage mit 0", () => {
    const usage = { "2026-08-20": { "a.com": 1000 } };
    assert.deepEqual(dailyTotals(usage, ["2026-08-20", "2026-08-19"]), {
        "2026-08-20": 1000, "2026-08-19": 0,
    });
});

test("aggregateDetail liefert Unterobjekte einer Domain", () => {
    const detail = {
        "2026-08-20": { "youtube.com": { "Kanal: A": 1000, "Kanal: B": 3000 } },
        "2026-08-19": { "youtube.com": { "Kanal: A": 500 } },
    };
    assert.deepEqual(aggregateDetail(detail, "youtube.com"), [["Kanal: B", 3000], ["Kanal: A", 1500]]);
    assert.deepEqual(aggregateDetail(detail, "andere.com"), []);
});

/* ------------------------------------------------------------------- report */

test("weekDays liefert Montag bis Sonntag", () => {
    const days = weekDays(new Date(2026, 7, 20, 12).getTime()); // Donnerstag
    assert.equal(days.length, 7);
    assert.equal(days[0], "2026-08-17", "beginnt am Montag");
    assert.equal(days[6], "2026-08-23", "endet am Sonntag");
});

test("Report vergleicht mit der Vorwoche", () => {
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
    assert.equal(report.score, 67, "zwei Drittel Arbeit");
    assert.match(reportSummary(report), /\+200 % zur Vorwoche/);
});

/* ------------------------------------------------------------------- export */

test("CSV maskiert Sonderzeichen und rechnet um", () => {
    const csv = toCSV({ "2026-08-20": { "a.com": 3600000, 'b",x.com': 60000 } });
    const lines = csv.split("\r\n");
    assert.match(lines[0], /Datum,Domain,Sekunden,Minuten,Stunden$/);
    assert.equal(lines[1], "2026-08-20,a.com,3600,60.00,1.000");
    assert.equal(lines[2], '2026-08-20,"b"",x.com",60,1.00,0.017');
});

/* --------------------------------------------------------------------- sync */

test("mergeUsage addiert Geraete, ohne Tage zu verlieren", () => {
    const local = { "2026-08-20": { "a.com": 1000 } };
    const remote = { "2026-08-20": { "a.com": 500, "b.com": 200 }, "2026-08-19": { "a.com": 300 } };
    assert.deepEqual(mergeUsage(local, remote), {
        "2026-08-20": { "a.com": 1500, "b.com": 200 },
        "2026-08-19": { "a.com": 300 },
    });
});
