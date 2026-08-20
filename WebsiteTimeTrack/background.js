/**
 * WebsiteTimeTrack – Service Worker
 *
 * Zeit wird nicht in einem Timer hochgezaehlt, sondern als Segment gemessen:
 * Bei jedem Ereignis, das die aktive Seite aendern kann (Tab-Wechsel, URL-
 * Wechsel, Fenster-Fokus, Idle, Interaktion), wird das laufende Segment
 * abgerechnet und ein neues gestartet. Ein Alarm im Minutentakt weckt den
 * Service Worker und schreibt zwischendurch weg, damit auch lange Sitzungen
 * ueberleben.
 *
 * Der gesamte Zustand liegt in chrome.storage.session: MV3 beendet den Service
 * Worker nach kurzer Idle-Zeit, Variablen im Modul-Scope waeren dann weg.
 */

import { dayKey } from "./lib/time.js";
import { domainOf, matchesAny, needsPageLookup, subEntityOf } from "./lib/entity.js";
import { getSettings } from "./lib/settings.js";
import {
    addTime, getSnooze, getUsage, migrate, prune, serialize, setSnooze,
} from "./lib/storage.js";
import {
    SNOOZE_MS, blockReason, blockedUrl, checkLimitNotification,
} from "./lib/limits.js";
import { maybeCreateWeeklyReport } from "./lib/report.js";
import * as sync from "./lib/sync.js";

const FLUSH_ALARM = "flush";
const MAINTENANCE_ALARM = "maintenance";
const FLUSH_PERIOD_MINUTES = 1;
const MAINTENANCE_PERIOD_MINUTES = 60;

// Segmente laenger als das hier stammen nicht aus echtem Browsen, sondern aus
// Standby / Ruhezustand, wo weder Alarm noch Idle-Event feuern. Wird verworfen.
const MAX_SEGMENT_MS = 5 * 60 * 1000;

/* --------------------------------------------------- Einstellungen (Cache) */

// Die Einstellungen werden bei jedem Ereignis gebraucht. Der Cache lebt nur so
// lange wie der Service Worker und wird bei Aenderungen sofort verworfen.
let settingsCache = null;

async function settings() {
    if (!settingsCache) settingsCache = await getSettings();
    return settingsCache;
}

chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === "sync" || area === "local") && changes.settings) settingsCache = null;
});

/* ------------------------------------------------------------ Sitzungsstatus */

async function sessionState() {
    const state = await chrome.storage.session.get(["active", "lastInteraction", "tabEntity"]);
    return {
        active: state.active || null,
        lastInteraction: state.lastInteraction || 0,
        tabEntity: state.tabEntity || {},
    };
}

/* --------------------------------------------------------------- Erfassung */

/**
 * Was zaehlt gerade – oder null.
 * Bedingungen: Nutzer nicht idle, ein Chrome-Fenster im Vordergrund, eine
 * trackbare URL, nicht auf der Ignorierliste, und – falls verlangt – eine
 * Interaktion in juengerer Vergangenheit.
 */
async function currentTarget(now) {
    const config = await settings();

    try {
        const idleState = await chrome.idle.queryState(config.idleSeconds);
        if (idleState !== "active") return null;

        // Kein fokussiertes Chrome-Fenster => der Nutzer ist in einer anderen App.
        const win = await chrome.windows.getLastFocused();
        if (!win || !win.focused) return null;

        const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
        if (!tab) return null;

        const domain = domainOf(tab.url);
        if (!domain) return null;
        if (matchesAny(domain, config.ignore)) return null;

        if (config.requireInteraction) {
            const { lastInteraction } = await sessionState();
            const stale = now - lastInteraction > config.interactionTimeoutSeconds * 1000;
            // Ein laufendes Video ist Nutzung, auch ohne Maus- oder Tastendruck.
            const audible = config.audibleCountsAsActive && tab.audible;
            if (stale && !audible) return null;
        }

        return {
            domain,
            entity: await entityFor(tab, config),
            audible: Boolean(tab.audible),
            tabId: tab.id,
        };
    } catch {
        // Fenster/Tab kann zwischen den Aufrufen verschwinden – dann eben nichts.
        return null;
    }
}

/** Unterobjekt aus der URL, fuer YouTube-Videos aus dem Content-Script. */
async function entityFor(tab, config) {
    if (!config.trackSubEntities) return null;

    const fromUrl = subEntityOf(tab.url, config.genericSubEntityDomains);
    if (fromUrl) return `${fromUrl.kind}: ${fromUrl.label}`;

    if (needsPageLookup(tab.url)) {
        const { tabEntity } = await sessionState();
        const label = tabEntity[String(tab.id)];
        if (label) return `Kanal: ${label}`;
    }
    return null;
}

/**
 * Bis wann darf das laufende Segment hoechstens gebucht werden?
 *
 * Zwei Faelle, in denen "jetzt" zu spaet ist:
 *  - Der Idle-Zustand wird erst nach Ablauf der Schwelle gemeldet. Untaetig war
 *    der Nutzer schon vorher.
 *  - Bei `requireInteraction` endet die Nutzung mit dem Interaktionsfenster,
 *    nicht erst beim naechsten Alarm.
 * Ohne die Kappung wuerde beides der zuletzt besuchten Seite gutgeschrieben.
 */
async function segmentDeadline(now, config, active, wentIdle) {
    let deadline = now;

    if (wentIdle) deadline = Math.min(deadline, now - config.idleSeconds * 1000);

    // Ein hoerbarer Tab gilt als Nutzung, da braucht es keine Interaktion.
    const audibleExempt = config.audibleCountsAsActive && active && active.audible;
    if (config.requireInteraction && !audibleExempt) {
        const { lastInteraction } = await sessionState();
        deadline = Math.min(deadline, lastInteraction + config.interactionTimeoutSeconds * 1000);
    }
    return deadline;
}

/** Rechnet das laufende Segment ab (hoechstens bis `until`). */
async function settle(active, until) {
    if (!active) return null;

    const elapsed = until - active.since;
    if (elapsed > 0 && elapsed <= MAX_SEGMENT_MS) {
        await addTime(active.domain, active.entity, active.since, until);
        return active.domain;
    }
    return null;
}

/**
 * Kernroutine: laufendes Segment abrechnen, neu bestimmen was aktiv ist.
 * Wird von jedem Ereignis und vom Alarm aufgerufen.
 */
function tick({ wentIdle = false } = {}) {
    return serialize(async () => {
        const now = Date.now();
        const config = await settings();
        const { active } = await sessionState();

        const until = await segmentDeadline(now, config, active, wentIdle);
        const settledDomain = await settle(active, until);
        const target = await currentTarget(now);

        await chrome.storage.session.set({
            active: target
                ? { domain: target.domain, entity: target.entity, audible: target.audible, since: now }
                : null,
        });

        // Erst nach dem Buchen pruefen, sonst haengt die Warnung eine Runde nach.
        const domain = settledDomain || (target && target.domain);
        if (domain) await checkLimits(domain, now);
    });
}

/** Limitwarnung und – falls faellig – Sperre. */
async function checkLimits(domain, now) {
    const config = await settings();
    const usage = await getUsage();
    const todayMs = (usage[dayKey(now)] || {})[domain] || 0;

    await checkLimitNotification(domain, todayMs, config, now);
    await enforce(config, now);
}

/* ------------------------------------------------------------------ Sperre */

/** Leitet alle Tabs gesperrter Domains auf die Sperrseite um. */
async function enforce(config, now = Date.now()) {
    try {
        const snooze = await getSnooze();
        const usage = await getUsage();
        const today = usage[dayKey(now)] || {};
        const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });

        for (const tab of tabs) {
            const domain = domainOf(tab.url);
            if (!domain) continue;

            const reason = blockReason(domain, {
                settings: config,
                todayMs: today[domain] || 0,
                snoozeUntil: snooze[domain] || 0,
                now,
            });
            if (!reason) continue;

            await chrome.tabs.update(tab.id, { url: blockedUrl(domain, tab.url, reason) });
        }
    } catch {
        // Einzelne Tabs koennen verschwinden – kein Grund, den Rest abzubrechen.
    }
}

/* ------------------------------------------------------------------- Events */

chrome.tabs.onActivated.addListener(() => tick());
chrome.tabs.onRemoved.addListener((tabId) => {
    forgetTab(tabId);
    tick();
});
chrome.windows.onFocusChanged.addListener(() => tick());
chrome.idle.onStateChanged.addListener((state) => tick({ wentIdle: state !== "active" }));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url) return;
    forgetTab(tabId); // Neue Seite, alter Kanalname gilt nicht mehr.
    if (tab.active) tick();
    else settings().then((config) => enforce(config)); // Auch Hintergrundtabs sperren.
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM) tick();
    if (alarm.name === MAINTENANCE_ALARM) maintenance();
});

chrome.notifications.onClicked.addListener((id) => {
    if (id.startsWith("report-")) chrome.runtime.openOptionsPage();
});

async function forgetTab(tabId) {
    const { tabEntity } = await sessionState();
    if (tabEntity[String(tabId)]) {
        delete tabEntity[String(tabId)];
        await chrome.storage.session.set({ tabEntity });
    }
}

/* ---------------------------------------------------------------- Nachrichten */

const handlers = {
    /** Popup laesst vor dem Rendern abrechnen, damit die laufende Zeit stimmt. */
    async sync() {
        await tick();
        return { ok: true };
    },

    /** Content-Script meldet Maus, Tastatur oder Scrollen. */
    async interaction() {
        await chrome.storage.session.set({ lastInteraction: Date.now() });
        const config = await settings();
        // Ohne die Option aendert eine Interaktion nichts am Ergebnis.
        if (config.requireInteraction) await tick();
        return { ok: true };
    },

    /** Content-Script liefert den Kanalnamen einer YouTube-Videoseite nach. */
    async entity(message, sender) {
        if (!sender.tab || !message.label) return { ok: false };
        const { tabEntity } = await sessionState();
        tabEntity[String(sender.tab.id)] = String(message.label).slice(0, 80);
        await chrome.storage.session.set({ tabEntity });
        await tick();
        return { ok: true };
    },

    /** Sperrseite bittet um eine kurze Ausnahme. */
    async snooze(message) {
        if (!message.domain) return { ok: false };
        await setSnooze(message.domain, Date.now() + SNOOZE_MS);
        return { ok: true, until: Date.now() + SNOOZE_MS };
    },

    /** Optionsseite hat Einstellungen geaendert – sofort anwenden. */
    async settingsChanged() {
        settingsCache = null;
        const config = await settings();
        chrome.idle.setDetectionInterval(config.idleSeconds);
        await enforce(config);
        return { ok: true };
    },

    /** Optionsseite stoesst den Geraeteabgleich von Hand an. */
    async pushSync() {
        const config = await settings();
        if (!config.syncUsage) return { ok: false, reason: "disabled" };
        await sync.push(config.syncDays);
        return { ok: true };
    },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = message && handlers[message.type];
    if (!handler) return false;

    handler(message, sender)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true; // Antwort kommt asynchron.
});

/* ------------------------------------------------------------------- Wartung */

/** Stuendlich: aufraeumen, Wochenreport pruefen, Geraeteabgleich schreiben. */
async function maintenance() {
    try {
        const config = await settings();
        await serialize(() => prune());
        await maybeCreateWeeklyReport(config);
        if (config.syncUsage) await sync.push(config.syncDays);
    } catch {
        // Wartung darf das Tracking nie stoppen.
    }
}

/* ------------------------------------------------------------------ Startup */

async function init() {
    const config = await settings();
    chrome.idle.setDetectionInterval(config.idleSeconds);
    await chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });
    await chrome.alarms.create(MAINTENANCE_ALARM, {
        periodInMinutes: MAINTENANCE_PERIOD_MINUTES,
    });
    await serialize(() => migrate());
    await tick();
    await maintenance();
}

chrome.runtime.onInstalled.addListener(() => init());
chrome.runtime.onStartup.addListener(() => init());

// Der Service Worker wird auch ausserhalb dieser beiden Ereignisse neu
// gestartet (z.B. nach Idle-Shutdown). Dann muss der aktive Tab sofort wieder
// erfasst werden, sonst zaehlt gar nichts, bis der Nutzer den Tab wechselt.
tick();
