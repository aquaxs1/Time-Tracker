/**
 * Geraete-Abgleich der Nutzungsdaten (optional, Standard aus).
 *
 * chrome.storage.sync ist knapp bemessen: ~100 KB gesamt, 8 KB je Eintrag,
 * 512 Eintraege, begrenzte Schreibrate. Deshalb werden nur die letzten Tage
 * abgeglichen, in Sekunden statt Millisekunden, und je Tag und Geraet ein
 * eigener Eintrag geschrieben.
 *
 * Jedes Geraet schreibt ausschliesslich in seine eigenen Keys. Damit gibt es
 * keine konkurrierenden Schreibzugriffe und keine Konflikte – beim Lesen
 * werden die fremden Geraete einfach dazuaddiert.
 */

import { lastDays } from "./time.js";
import { deviceId, getUsage } from "./storage.js";

const PREFIX = "u_";
const MAX_ITEM_BYTES = 7000; // 8 KB Limit mit Sicherheitsabstand.

function keyFor(device, day) {
    return `${PREFIX}${device}_${day}`;
}

function parseKey(key) {
    if (!key.startsWith(PREFIX)) return null;
    const rest = key.slice(PREFIX.length);
    const split = rest.lastIndexOf("_");
    if (split < 0) return null;
    return { device: rest.slice(0, split), day: rest.slice(split + 1) };
}

/** Grosse Tage kuerzen: die kleinsten Domains fliegen raus, bis es passt. */
function trimToLimit(bucket) {
    let entries = Object.entries(bucket).sort((a, b) => b[1] - a[1]);
    while (entries.length > 0) {
        const candidate = Object.fromEntries(entries);
        if (JSON.stringify(candidate).length <= MAX_ITEM_BYTES) return candidate;
        entries = entries.slice(0, -1);
    }
    return {};
}

/** Lokale Daten der letzten `days` Tage in den Sync-Bereich schreiben. */
export async function push(days) {
    const device = await deviceId();
    const usage = await getUsage();
    const wanted = lastDays(days);
    const payload = {};

    for (const day of wanted) {
        const bucket = usage[day];
        if (!bucket) continue;

        // Sekunden reichen fuer den Abgleich und sparen deutlich Platz.
        const compact = {};
        for (const [domain, ms] of Object.entries(bucket)) {
            const seconds = Math.round(ms / 1000);
            if (seconds > 0) compact[domain] = seconds;
        }
        if (Object.keys(compact).length) payload[keyFor(device, day)] = trimToLimit(compact);
    }

    // Eigene Eintraege ausserhalb des Fensters wieder freigeben.
    const existing = await chrome.storage.sync.get(null);
    const stale = Object.keys(existing).filter((key) => {
        const parsed = parseKey(key);
        return parsed && parsed.device === device && !wanted.includes(parsed.day);
    });

    if (stale.length) await chrome.storage.sync.remove(stale);
    if (Object.keys(payload).length) await chrome.storage.sync.set(payload);
}

/**
 * Daten aller *anderen* Geraete lesen, als { day: { domain: ms } }.
 * Die eigenen Daten kommen aus dem lokalen Speicher – sonst zaehlt alles doppelt.
 */
export async function pullOthers() {
    const device = await deviceId();
    const all = await chrome.storage.sync.get(null);
    const merged = {};

    for (const [key, bucket] of Object.entries(all)) {
        const parsed = parseKey(key);
        if (!parsed || parsed.device === device) continue;
        if (!bucket || typeof bucket !== "object") continue;

        const day = merged[parsed.day] || (merged[parsed.day] = {});
        for (const [domain, seconds] of Object.entries(bucket)) {
            if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) continue;
            day[domain] = (day[domain] || 0) + seconds * 1000;
        }
    }
    return merged;
}

/** Lokale und fremde Tages-Buckets zu einer Ansicht verschmelzen. */
export function mergeUsage(local, remote) {
    const merged = {};
    for (const source of [local, remote]) {
        for (const [day, bucket] of Object.entries(source || {})) {
            const target = merged[day] || (merged[day] = {});
            for (const [domain, ms] of Object.entries(bucket || {})) {
                if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) continue;
                target[domain] = (target[domain] || 0) + ms;
            }
        }
    }
    return merged;
}

/** Lokale Daten plus – falls eingeschaltet – die der anderen Geraete. */
export async function usageForDisplay(settings) {
    const local = await getUsage();
    if (!settings || !settings.syncUsage) return local;
    try {
        return mergeUsage(local, await pullOthers());
    } catch {
        return local; // Sync darf die Anzeige nie blockieren.
    }
}

/** Alle eigenen Sync-Eintraege entfernen (beim Abschalten des Abgleichs). */
export async function clearOwn() {
    const device = await deviceId();
    const all = await chrome.storage.sync.get(null);
    const own = Object.keys(all).filter((key) => {
        const parsed = parseKey(key);
        return parsed && parsed.device === device;
    });
    if (own.length) await chrome.storage.sync.remove(own);
}
