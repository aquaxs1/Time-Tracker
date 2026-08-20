/**
 * Datenhaltung.
 *
 * chrome.storage.local:
 *   usage   { "YYYY-MM-DD": { "domain.com": ms } }        Tagessummen je Domain
 *   detail  { "YYYY-MM-DD": { "domain.com": { label: ms } } }  Unterobjekte
 *   meta    { schema, deviceId }
 *   notified{ "YYYY-MM-DD": { "domain.com": prozentstufe } }
 *   reports [ Wochenreport, ... ]
 *   snooze  { "domain.com": timestamp }
 *
 * Alle Schreibzugriffe laufen ueber serialize(): storage.get + storage.set ist
 * nicht atomar, und ohne Kette koennen sich parallele Ereignisse gegenseitig
 * ueberschreiben.
 */

import { dayKey, splitByDay, lastDays } from "./time.js";

export const SCHEMA_VERSION = 3;

const USAGE_RETENTION_DAYS = 365;
const DETAIL_RETENTION_DAYS = 60;
const MAX_REPORTS = 8;

/* ------------------------------------------------------------ Schreibkette */

let writeChain = Promise.resolve();

export function serialize(task) {
    const run = writeChain.then(task, task);
    writeChain = run.catch(() => {});
    return run;
}

/* -------------------------------------------------------------------- Lesen */

export async function getUsage() {
    const { usage } = await chrome.storage.local.get("usage");
    return usage && typeof usage === "object" ? usage : {};
}

export async function getDetail() {
    const { detail } = await chrome.storage.local.get("detail");
    return detail && typeof detail === "object" ? detail : {};
}

/**
 * Summiert Tages-Buckets zu einer sortierten Liste [domain, ms].
 * `days` = null bedeutet: alle Tage.
 */
export function aggregate(usage, days = null) {
    const filter = days ? new Set(days) : null;
    const totals = new Map();

    for (const [day, bucket] of Object.entries(usage || {})) {
        if (filter && !filter.has(day)) continue;
        if (!bucket || typeof bucket !== "object") continue;
        for (const [domain, ms] of Object.entries(bucket)) {
            if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) continue;
            totals.set(domain, (totals.get(domain) || 0) + ms);
        }
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
}

/** Tagessumme ueber alle Domains, als { day: ms }. */
export function dailyTotals(usage, days) {
    const result = {};
    for (const day of days) {
        const bucket = usage[day] || {};
        result[day] = Object.values(bucket).reduce(
            (sum, ms) => sum + (typeof ms === "number" && ms > 0 ? ms : 0),
            0,
        );
    }
    return result;
}

/** Heutige Zeit einer einzelnen Domain – Grundlage fuer die Limitpruefung. */
export async function todayTotal(domain) {
    const usage = await getUsage();
    return (usage[dayKey(Date.now())] || {})[domain] || 0;
}

/** Unterobjekte einer Domain im Zeitraum, sortiert. */
export function aggregateDetail(detail, domain, days = null) {
    const filter = days ? new Set(days) : null;
    const totals = new Map();

    for (const [day, byDomain] of Object.entries(detail || {})) {
        if (filter && !filter.has(day)) continue;
        const bucket = (byDomain || {})[domain];
        if (!bucket || typeof bucket !== "object") continue;
        for (const [label, ms] of Object.entries(bucket)) {
            if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) continue;
            totals.set(label, (totals.get(label) || 0) + ms);
        }
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
}

/* ----------------------------------------------------------------- Schreiben */

/** Bucht ein Segment auf Domain und optional auf ein Unterobjekt. */
export async function addTime(domain, entityLabel, start, end) {
    const { usage = {}, detail = {} } = await chrome.storage.local.get(["usage", "detail"]);

    for (const [day, ms] of splitByDay(start, end)) {
        if (ms <= 0) continue;

        const bucket = usage[day] || (usage[day] = {});
        bucket[domain] = (bucket[domain] || 0) + ms;

        if (entityLabel) {
            const byDomain = detail[day] || (detail[day] = {});
            const labels = byDomain[domain] || (byDomain[domain] = {});
            labels[entityLabel] = (labels[entityLabel] || 0) + ms;
        }
    }
    await chrome.storage.local.set({ usage, detail });
}

/** Loescht eine einzelne Domain aus allen Tagen. */
export async function clearDomain(domain) {
    const { usage = {}, detail = {} } = await chrome.storage.local.get(["usage", "detail"]);
    for (const bucket of Object.values(usage)) delete bucket[domain];
    for (const byDomain of Object.values(detail)) delete byDomain[domain];
    await chrome.storage.local.set({ usage, detail });
}

export async function clearAll() {
    await chrome.storage.local.set({ usage: {}, detail: {}, notified: {} });
}

/* ------------------------------------------------------------- Aufraeumen */

/** Wirft alte Tage weg, damit der Speicher nicht unbegrenzt waechst. */
export async function prune(now = Date.now()) {
    const { usage = {}, detail = {}, notified = {} } = await chrome.storage.local.get([
        "usage", "detail", "notified",
    ]);

    const keepUsage = new Set(lastDays(USAGE_RETENTION_DAYS, now));
    const keepDetail = new Set(lastDays(DETAIL_RETENTION_DAYS, now));
    const keepNotified = new Set(lastDays(2, now));

    let changed = false;
    for (const day of Object.keys(usage)) {
        if (!keepUsage.has(day)) { delete usage[day]; changed = true; }
    }
    for (const day of Object.keys(detail)) {
        if (!keepDetail.has(day)) { delete detail[day]; changed = true; }
    }
    for (const day of Object.keys(notified)) {
        if (!keepNotified.has(day)) { delete notified[day]; changed = true; }
    }
    if (changed) await chrome.storage.local.set({ usage, detail, notified });
}

/* --------------------------------------------------------------- Reports */

export async function saveReport(report) {
    const { reports = [] } = await chrome.storage.local.get("reports");
    const kept = reports.filter((r) => r.week !== report.week);
    kept.unshift(report);
    await chrome.storage.local.set({ reports: kept.slice(0, MAX_REPORTS) });
}

export async function getReports() {
    const { reports } = await chrome.storage.local.get("reports");
    return Array.isArray(reports) ? reports : [];
}

/* ------------------------------------------------------- Benachrichtigungen */

/** Merkt sich, bis zu welcher Prozentstufe heute schon gewarnt wurde. */
export async function notifiedLevel(domain, now = Date.now()) {
    const { notified = {} } = await chrome.storage.local.get("notified");
    return (notified[dayKey(now)] || {})[domain] || 0;
}

export async function setNotifiedLevel(domain, level, now = Date.now()) {
    const { notified = {} } = await chrome.storage.local.get("notified");
    const day = notified[dayKey(now)] || (notified[dayKey(now)] = {});
    day[domain] = level;
    await chrome.storage.local.set({ notified });
}

/* -------------------------------------------------------------- Snooze */

export async function getSnooze() {
    const { snooze } = await chrome.storage.local.get("snooze");
    return snooze && typeof snooze === "object" ? snooze : {};
}

export async function setSnooze(domain, until) {
    const snooze = await getSnooze();
    snooze[domain] = until;
    await chrome.storage.local.set({ snooze });
}

/* -------------------------------------------------------------- Geraete-ID */

/** Stabile, zufaellige ID – nur zum Trennen der Sync-Buckets je Geraet. */
export async function deviceId() {
    const { meta = {} } = await chrome.storage.local.get("meta");
    if (meta.deviceId) return meta.deviceId;

    const id = `dev-${Math.random().toString(36).slice(2, 10)}`;
    await chrome.storage.local.set({ meta: { ...meta, deviceId: id } });
    return id;
}

/* ------------------------------------------------------------- Migration */

/**
 * v1 (flache Keys mit Sekunden) und v2 (usage in Millisekunden) auf v3 heben.
 * v3 ergaenzt nur `detail`, die Zeitdaten selbst bleiben unveraendert.
 */
export async function migrate(now = Date.now()) {
    const all = await chrome.storage.local.get(null);
    const meta = all.meta && typeof all.meta === "object" ? all.meta : {};
    if (meta.schema >= SCHEMA_VERSION) return;

    const usage = all.usage && typeof all.usage === "object" ? all.usage : {};
    const legacyKeys = [];
    const known = new Set([
        "usage", "detail", "meta", "notified", "reports", "snooze", "settings",
    ]);

    // v1: jede Domain lag als eigener Top-Level-Key mit Sekunden.
    for (const [key, value] of Object.entries(all)) {
        if (known.has(key)) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
        const bucket = usage[dayKey(now)] || (usage[dayKey(now)] = {});
        bucket[key] = (bucket[key] || 0) + value * 1000;
        legacyKeys.push(key);
    }

    await chrome.storage.local.set({
        usage,
        detail: all.detail && typeof all.detail === "object" ? all.detail : {},
        meta: { ...meta, schema: SCHEMA_VERSION },
    });
    if (legacyKeys.length) await chrome.storage.local.remove(legacyKeys);
}
