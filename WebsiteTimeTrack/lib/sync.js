/**
 * Cross-device sync of usage data (optional, off by default).
 *
 * chrome.storage.sync is small: ~100 KB total, 8 KB per item, 512 items,
 * a limited write rate. So only the most recent days are synced, in seconds
 * rather than milliseconds, with one item written per day and device.
 *
 * Each device writes only to its own keys. That means no competing writes and
 * no conflicts – on read, the other devices' data is simply added on top.
 */

import { lastDays } from "./time.js";
import { deviceId, getUsage } from "./storage.js";

const PREFIX = "u_";
const MAX_ITEM_BYTES = 7000; // 8 KB limit with a safety margin.

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

/** Trims a large day: the smallest domains drop off until it fits. */
function trimToLimit(bucket) {
    let entries = Object.entries(bucket).sort((a, b) => b[1] - a[1]);
    while (entries.length > 0) {
        const candidate = Object.fromEntries(entries);
        if (JSON.stringify(candidate).length <= MAX_ITEM_BYTES) return candidate;
        entries = entries.slice(0, -1);
    }
    return {};
}

/** Writes local data for the last `days` days into the sync area. */
export async function push(days) {
    const device = await deviceId();
    const usage = await getUsage();
    const wanted = lastDays(days);
    const payload = {};

    for (const day of wanted) {
        const bucket = usage[day];
        if (!bucket) continue;

        // Seconds are precise enough for sync and save noticeable space.
        const compact = {};
        for (const [domain, ms] of Object.entries(bucket)) {
            const seconds = Math.round(ms / 1000);
            if (seconds > 0) compact[domain] = seconds;
        }
        if (Object.keys(compact).length) payload[keyFor(device, day)] = trimToLimit(compact);
    }

    // Release this device's own entries that have fallen outside the window.
    const existing = await chrome.storage.sync.get(null);
    const stale = Object.keys(existing).filter((key) => {
        const parsed = parseKey(key);
        return parsed && parsed.device === device && !wanted.includes(parsed.day);
    });

    if (stale.length) await chrome.storage.sync.remove(stale);
    if (Object.keys(payload).length) await chrome.storage.sync.set(payload);
}

/**
 * Reads data from every *other* device, as { day: { domain: ms } }.
 * This device's own data comes from local storage – otherwise everything
 * would count twice.
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

/** Merges local and remote daily buckets into a single view. */
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

/** Local data, plus other devices' data if sync is turned on. */
export async function usageForDisplay(settings) {
    const local = await getUsage();
    if (!settings || !settings.syncUsage) return local;
    try {
        return mergeUsage(local, await pullOthers());
    } catch {
        return local; // Sync must never block the display.
    }
}

/** Removes all of this device's own sync entries (when sync is turned off). */
export async function clearOwn() {
    const device = await deviceId();
    const all = await chrome.storage.sync.get(null);
    const own = Object.keys(all).filter((key) => {
        const parsed = parseKey(key);
        return parsed && parsed.device === device;
    });
    if (own.length) await chrome.storage.sync.remove(own);
}
