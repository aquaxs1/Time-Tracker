/**
 * Integrationstests des Service Workers gegen den Chrome-Mock.
 * Jeder Test startet den Worker frisch – wie nach einem Idle-Shutdown.
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
 * Startet den Service Worker mit frischem Zustand.
 * Der Query-Parameter umgeht den ES-Modul-Cache – ohne ihn liefe der
 * Modulrumpf kein zweites Mal und es wuerden keine Listener registriert.
 */
async function boot(world) {
    const chrome = install(world);
    await import(`${SRC}?v=${loadCounter++}`);
    await settleQueue();
    return chrome;
}

/** Welt mit einem aktiven Tab auf `url`. */
function worldWith(url, extra = {}) {
    return makeWorld({
        tabs: [{ id: 1, url, active: true, windowId: 1, audible: false }],
        ...extra,
    });
}

/** Einstellungen so ablegen, wie getSettings() sie liest. */
function withSettings(world, settings) {
    world.sync.settings = settings;
    return world;
}

const alarm = (chrome) => fire(chrome, "alarm", { name: "flush" });

/* ------------------------------------------------------------- Grundmessung */

test("aktiver Tab wird beim Start des Workers sofort erfasst", async () => {
    const world = worldWith("https://www.youtube.com/watch?v=1");
    const chrome = await boot(world);

    assert.equal(world.session.active.domain, "youtube.com", "www. wird gestrippt");

    tick(30_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "youtube.com"), 30_000);
});

test("Idle stoppt die Messung und die Rueckkehr startet sie wieder", async () => {
    const world = worldWith("https://github.com/x/y");
    const chrome = await boot(world);

    // Chrome meldet den Idle-Zustand erst nach Ablauf der Schwelle (60 s).
    // Untaetig war der Nutzer da schon eine Minute – nur die 10 s davor zaehlen.
    tick(70_000);
    world.idleState = "idle";
    await fire(chrome, "idle", "idle");
    assert.equal(totalFor(world.local, "github.com"), 10_000, "Idle-Schwelle abgezogen");

    tick(600_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "github.com"), 10_000, "Idle-Zeit zaehlt nicht");

    world.idleState = "active";
    await fire(chrome, "idle", "active");
    tick(5_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "github.com"), 15_000, "danach wieder aktiv");
});

test("ohne fokussiertes Fenster laeuft die Uhr nicht", async () => {
    const world = worldWith("https://news.ycombinator.com/");
    const chrome = await boot(world);

    tick(8_000);
    world.windowFocused = false;
    await fire(chrome, "focus", -1);

    tick(120_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "news.ycombinator.com"), 8_000);
});

test("Tabwechsel bucht auf die jeweils richtige Domain", async () => {
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

test("chrome:// und Tabs ohne URL stuerzen nicht ab", async () => {
    const world = worldWith("chrome://extensions");
    const chrome = await boot(world);

    tick(5_000);
    await alarm(chrome);
    assert.equal(world.local.usage, undefined, "nichts gebucht");

    world.tabs = [{ id: 3, url: undefined, active: true, windowId: 1 }];
    await fire(chrome, "tabActivated", { tabId: 3 });
    tick(5_000);
    await alarm(chrome);
});

test("Standby erzeugt keine Fantasiezeiten", async () => {
    const world = worldWith("https://sleep.example/");
    const chrome = await boot(world);

    tick(8 * 60 * 60 * 1000); // Laptop zugeklappt, kein Event gefeuert
    await alarm(chrome);
    assert.equal(totalFor(world.local, "sleep.example"), 0);
});

test("Segmente ueber Mitternacht landen auf beiden Tagen", async () => {
    now = new Date(2026, 7, 20, 23, 59).getTime();
    const world = worldWith("https://late.example/");
    const chrome = await boot(world);

    tick(120_000);
    await alarm(chrome);
    assert.equal(world.local.usage["2026-08-20"]["late.example"], 60_000);
    assert.equal(world.local.usage["2026-08-21"]["late.example"], 60_000);

    now = new Date(2026, 7, 20, 10).getTime();
});

/* ------------------------------------------------------------- Ignorierliste */

test("ignorierte Domains werden gar nicht erfasst", async () => {
    const world = withSettings(worldWith("https://intern.firma.de/x"), {
        ignore: ["firma.de"],
    });
    const chrome = await boot(world);

    tick(30_000);
    await alarm(chrome);
    assert.equal(world.local.usage, undefined);
    assert.equal(world.session.active, null);
});

/* -------------------------------------------------------------- Interaktion */

test("ohne Interaktion zaehlt ein offener Tab nicht", async () => {
    const world = withSettings(worldWith("https://video.example/"), {
        requireInteraction: true,
        interactionTimeoutSeconds: 90,
    });
    const chrome = await boot(world);

    assert.equal(world.session.active, null, "noch keine Interaktion gemeldet");

    await sendMessage(chrome, { type: "interaction" }, { tab: { id: 1 } });
    await settleQueue();
    assert.equal(world.session.active.domain, "video.example", "nach Interaktion laeuft es");

    tick(20_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "video.example"), 20_000);

    // Ohne weitere Interaktion endet die Nutzung mit dem 90-Sekunden-Fenster –
    // nicht erst, wenn der naechste Alarm das Ende bemerkt.
    tick(200_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "video.example"), 90_000, "auf das Fenster gekappt");

    tick(200_000);
    await alarm(chrome);
    assert.equal(totalFor(world.local, "video.example"), 90_000, "danach nichts mehr");
});

test("Tabs mit Ton zaehlen auch ohne Interaktion", async () => {
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

/* ------------------------------------------------------------ Unterobjekte */

test("GitHub-Repo wird aus der URL erfasst", async () => {
    const world = worldWith("https://github.com/aquaxs1/Time-Tracker/pull/1");
    const chrome = await boot(world);

    tick(30_000);
    await alarm(chrome);
    assert.equal(
        world.local.detail["2026-08-20"]["github.com"]["Repo: aquaxs1/Time-Tracker"],
        30_000,
    );
});

test("YouTube-Kanal kommt aus dem Content-Script", async () => {
    const world = worldWith("https://www.youtube.com/watch?v=abc");
    const chrome = await boot(world);

    tick(10_000);
    await sendMessage(chrome, { type: "entity", label: "Kurzgesagt" }, { tab: { id: 1 } });
    await settleQueue();

    tick(20_000);
    await alarm(chrome);

    const detail = world.local.detail["2026-08-20"]["youtube.com"];
    assert.equal(detail["Kanal: Kurzgesagt"], 20_000);
    assert.equal(totalFor(world.local, "youtube.com"), 30_000, "Domain zaehlt die ganze Zeit");
});

test("Navigation verwirft den Kanalnamen des alten Videos", async () => {
    const world = worldWith("https://www.youtube.com/watch?v=abc");
    const chrome = await boot(world);

    await sendMessage(chrome, { type: "entity", label: "Kanal A" }, { tab: { id: 1 } });
    await settleQueue();

    world.tabs[0].url = "https://www.youtube.com/watch?v=xyz";
    await fire(chrome, "tabUpdated", 1, { url: world.tabs[0].url }, world.tabs[0]);

    tick(20_000);
    await alarm(chrome);
    const detail = ((world.local.detail || {})["2026-08-20"] || {})["youtube.com"] || {};
    assert.equal(detail["Kanal: Kanal A"], undefined, "alter Kanal wird nicht weitergezaehlt");
    assert.equal(totalFor(world.local, "youtube.com"), 20_000, "die Domain zaehlt weiter");
});

/* ------------------------------------------------------------------ Limits */

test("Warnung bei 80 Prozent, Meldung bei 100 Prozent", async () => {
    const world = withSettings(worldWith("https://youtube.com/feed"), {
        limits: { "youtube.com": { minutes: 10, block: false } },
        notifyAtPercent: 80,
    });
    // 8 von 10 Minuten sind schon zusammengekommen.
    world.local.usage = { "2026-08-20": { "youtube.com": 8 * 60000 } };
    const chrome = await boot(world);

    await alarm(chrome);
    assert.equal(world.notifications.length, 1, "eine Warnung");
    assert.match(world.notifications[0].title, /Bald am Limit/);

    await alarm(chrome);
    assert.equal(world.notifications.length, 1, "nicht doppelt warnen");

    world.local.usage["2026-08-20"]["youtube.com"] = 10 * 60000;
    await alarm(chrome);
    assert.equal(world.notifications.length, 2);
    assert.match(world.notifications[1].title, /Limit erreicht/);
});

test("erreichtes Limit sperrt den Tab, Snooze gibt ihn frei", async () => {
    const world = withSettings(worldWith("https://reddit.com/r/de"), {
        limits: { "reddit.com": { minutes: 5, block: true } },
    });
    world.local.usage = { "2026-08-20": { "reddit.com": 6 * 60000 } };
    const chrome = await boot(world);

    await alarm(chrome);
    assert.equal(world.updated.length, 1, "Tab wurde umgeleitet");
    assert.match(world.updated[0].url, /blocked\.html\?d=reddit\.com/);
    assert.match(world.updated[0].url, /r=limit/);

    // Ausnahme anfordern und wieder auf die Seite zurueck.
    const response = await sendMessage(chrome, { type: "snooze", domain: "reddit.com" });
    assert.equal(response.ok, true);

    world.tabs[0].url = "https://reddit.com/r/de";
    world.updated.length = 0;
    await alarm(chrome);
    assert.equal(world.updated.length, 0, "waehrend des Snooze keine Sperre");

    tick(6 * 60 * 1000); // Snooze abgelaufen
    await alarm(chrome);
    assert.equal(world.updated.length, 1, "danach wieder gesperrt");
});

test("Fokusmodus sperrt Ablenkung, laesst Arbeit durch", async () => {
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
    assert.equal(world.updated[0].tabId, 1, "nur der Social-Tab");
    assert.match(world.updated[0].url, /r=focus/);
});

test("abgelaufener Fokusmodus sperrt nicht mehr", async () => {
    const world = withSettings(worldWith("https://instagram.com/"), {
        focus: { active: true, until: now - 1000, sites: [] },
    });
    const chrome = await boot(world);

    await alarm(chrome);
    assert.equal(world.updated.length, 0);
});

/* ------------------------------------------------------------- Wartung */

test("Wochenreport entsteht einmal pro Woche", async () => {
    const world = withSettings(worldWith("https://example.com/"), { weeklyReport: true });
    // Vorwoche mit Daten fuellen (Mo 10.8. bis So 16.8.2026).
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
    assert.equal(world.local.reports.length, 1, "kein zweiter Report fuer dieselbe Woche");
});

test("alte Tage werden aufgeraeumt", async () => {
    const world = worldWith("https://example.com/");
    world.local.usage = {
        "2026-08-19": { "a.com": 1000 },
        "2024-01-01": { "alt.com": 1000 },
    };
    const chrome = await boot(world);

    await fire(chrome, "alarm", { name: "maintenance" });
    assert.ok(world.local.usage["2026-08-19"], "junge Tage bleiben");
    assert.equal(world.local.usage["2024-01-01"], undefined, "alte Tage fliegen raus");
});

/* ---------------------------------------------------------------- Migration */

test("Daten aus Version 1.0 werden uebernommen", async () => {
    const world = worldWith("https://neu.example/");
    world.local = { "youtube.com": 3600, "old.example": 90, notanumber: "x" };
    const chrome = await boot(world);

    await fire(chrome, "installed");
    await settleQueue();

    assert.equal(world.local.usage["2026-08-20"]["youtube.com"], 3_600_000, "Sekunden zu ms");
    assert.equal(world.local.usage["2026-08-20"]["old.example"], 90_000);
    assert.equal(world.local["youtube.com"], undefined, "alte Keys entfernt");
    assert.equal(world.local.notanumber, "x", "fremde Keys bleiben");
    assert.equal(world.local.meta.schema, 3);
});

/* -------------------------------------------------------------- Nachrichten */

test("Popup erzwingt die Abrechnung der laufenden Zeit", async () => {
    const world = worldWith("https://msg.example/");
    const chrome = await boot(world);

    tick(3_000);
    const response = await sendMessage(chrome, { type: "sync" });
    assert.deepEqual(response, { ok: true });
    assert.equal(totalFor(world.local, "msg.example"), 3_000);
});

test("geaenderte Einstellungen wirken sofort", async () => {
    const world = worldWith("https://instagram.com/");
    const chrome = await boot(world);

    tick(5_000);
    await alarm(chrome);
    assert.equal(world.updated.length, 0);

    // Fokusmodus einschalten, wie es die Optionsseite tut.
    world.sync.settings = { focus: { active: true, until: now + 600000, sites: [] } };
    await sendMessage(chrome, { type: "settingsChanged" });
    await settleQueue();

    assert.equal(world.updated.length, 1, "Sperre greift ohne Neustart");
});

test("unbekannte Nachrichten werden nicht beantwortet", async () => {
    const world = worldWith("https://example.com/");
    const chrome = await boot(world);
    assert.equal(await sendMessage(chrome, { type: "gibtsnicht" }), undefined);
});
