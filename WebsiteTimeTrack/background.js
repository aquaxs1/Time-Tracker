/**
 * WebsiteTimeTrack – Service Worker
 *
 * Zeit wird nicht in einem Timer hochgezaehlt, sondern als Segment gemessen:
 * Bei jedem Ereignis, das die aktive Seite aendern kann (Tab-Wechsel, URL-
 * Wechsel, Fenster-Fokus, Idle), wird das laufende Segment abgerechnet und ein
 * neues gestartet. Ein Alarm im Minutentakt weckt den Service Worker und
 * schreibt zwischendurch weg, damit auch lange Sitzungen ueberleben.
 *
 * Der gesamte Zustand liegt in chrome.storage.session: MV3 beendet den Service
 * Worker nach kurzer Idle-Zeit, Variablen im Modul-Scope waeren dann weg.
 */

const IDLE_DETECTION_SECONDS = 60;
const FLUSH_ALARM = "flush";
const FLUSH_PERIOD_MINUTES = 1;

// Segmente laenger als das hier stammen nicht aus echtem Browsen, sondern aus
// Standby / Ruhezustand, wo weder Alarm noch Idle-Event feuern. Wird verworfen.
const MAX_SEGMENT_MS = 5 * 60 * 1000;

const SCHEMA_VERSION = 2;

/* ------------------------------------------------------------------ Helpers */

/** Lokaler Tagesschluessel (YYYY-MM-DD) – bewusst lokal, nicht UTC. */
function dayKey(timestamp) {
    const d = new Date(timestamp);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
}

/** Verteilt ein Segment auf Tages-Buckets, falls es ueber Mitternacht laeuft. */
function splitByDay(start, end) {
    const parts = [];
    let cursor = start;
    while (cursor < end) {
        const d = new Date(cursor);
        const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
        const chunkEnd = Math.min(end, nextMidnight);
        parts.push([dayKey(cursor), chunkEnd - cursor]);
        cursor = chunkEnd;
    }
    return parts;
}

/** Hostname einer trackbaren URL, sonst null. */
function domainOf(url) {
    if (!url) return null;
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.hostname.replace(/^www\./, "");
}

/**
 * Serialisiert alle Schreibzugriffe. storage.get/set ist nicht atomar – ohne
 * Kette koennen zwei parallele Ereignisse dieselbe Basis lesen und der
 * spaetere Write den frueheren ueberschreiben.
 */
let writeChain = Promise.resolve();
function serialize(task) {
    const run = writeChain.then(task, task);
    writeChain = run.catch(() => {});
    return run;
}

/* ------------------------------------------------------------------ Storage */

async function addTime(domain, start, end) {
    const { usage = {} } = await chrome.storage.local.get("usage");
    for (const [day, ms] of splitByDay(start, end)) {
        if (ms <= 0) continue;
        const bucket = usage[day] || (usage[day] = {});
        bucket[domain] = (bucket[domain] || 0) + ms;
    }
    await chrome.storage.local.set({ usage });
}

/* ------------------------------------------------------------------ Tracking */

/** Welche Domain zaehlt gerade – oder null, wenn nichts zaehlen soll. */
async function currentDomain() {
    try {
        const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);
        if (idleState !== "active") return null;

        // Kein fokussiertes Chrome-Fenster => der Nutzer ist in einer anderen App.
        const win = await chrome.windows.getLastFocused();
        if (!win || !win.focused) return null;

        const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
        return domainOf(tab && tab.url);
    } catch {
        // Fenster/Tab kann zwischen den Aufrufen verschwinden – dann eben nichts.
        return null;
    }
}

/** Rechnet das laufende Segment ab und startet ein neues ab `now`. */
async function settle(now) {
    const { active } = await chrome.storage.session.get("active");
    if (!active) return;

    const elapsed = now - active.since;
    if (elapsed > 0 && elapsed <= MAX_SEGMENT_MS) {
        await addTime(active.domain, active.since, now);
    }
    await chrome.storage.session.set({ active: { ...active, since: now } });
}

/**
 * Kernroutine: laufendes Segment abrechnen, neu bestimmen was aktiv ist.
 * Wird von jedem Ereignis und vom Alarm aufgerufen.
 */
function sync() {
    return serialize(async () => {
        const now = Date.now();
        await settle(now);
        const domain = await currentDomain();
        await chrome.storage.session.set({ active: domain ? { domain, since: now } : null });
    });
}

/* ------------------------------------------------------------------- Events */

chrome.tabs.onActivated.addListener(() => sync());
chrome.tabs.onRemoved.addListener(() => sync());
chrome.windows.onFocusChanged.addListener(() => sync());
chrome.idle.onStateChanged.addListener(() => sync());

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    // Nur echte Navigationen im aktiven Tab sind relevant.
    if (changeInfo.url && tab.active) sync();
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM) sync();
});

// Der Popup laesst vor dem Rendern abrechnen, damit die laufende Sekunde
// mitgezaehlt wird und nicht bis zum naechsten Alarm fehlt.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "sync") {
        sync().then(() => sendResponse({ ok: true }));
        return true; // Antwort kommt asynchron.
    }
    return false;
});

/* ------------------------------------------------------------------ Startup */

/** Altes Schema (flache Keys mit Sekunden) in Tages-Buckets ueberfuehren. */
async function migrate() {
    const all = await chrome.storage.local.get(null);
    if (all.meta && all.meta.schema >= SCHEMA_VERSION) return;

    const usage = all.usage || {};
    const legacyKeys = [];
    const today = dayKey(Date.now());

    for (const [key, value] of Object.entries(all)) {
        if (key === "usage" || key === "meta") continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
        const bucket = usage[today] || (usage[today] = {});
        bucket[key] = (bucket[key] || 0) + value * 1000; // Sekunden -> Millisekunden
        legacyKeys.push(key);
    }

    await chrome.storage.local.set({ usage, meta: { schema: SCHEMA_VERSION } });
    if (legacyKeys.length) await chrome.storage.local.remove(legacyKeys);
}

async function init() {
    chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
    await chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });
    await serialize(migrate);
    await sync();
}

chrome.runtime.onInstalled.addListener(() => init());
chrome.runtime.onStartup.addListener(() => init());

// Der Service Worker wird auch ausserhalb dieser beiden Ereignisse neu
// gestartet (z.B. nach Idle-Shutdown). Dann muss der aktive Tab sofort wieder
// erfasst werden, sonst zaehlt gar nichts, bis der Nutzer den Tab wechselt.
sync();
