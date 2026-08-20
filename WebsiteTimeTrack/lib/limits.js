/**
 * Tageslimits, Benachrichtigungen und Sperre.
 *
 * Zwei Wege fuehren zur Sperre:
 *   1. Ein Tageslimit fuer die Domain ist erreicht und "sperren" ist aktiv.
 *   2. Der Fokusmodus laeuft und die Domain steht auf seiner Liste.
 * Beides laesst sich per Snooze kurz aussetzen, sonst wird die Sperre zur
 * Uebung im Deaktivieren der Extension.
 */

import { categoryOf } from "./categories.js";
import { matchesPattern } from "./entity.js";
import { focusActive } from "./settings.js";
import { formatMinutes } from "./time.js";
import { notifiedLevel, setNotifiedLevel } from "./storage.js";

export const SNOOZE_MS = 5 * 60 * 1000;

/** Im Fokusmodus ohne eigene Liste gelten diese Kategorien als Ablenkung. */
const FOCUS_DEFAULT_CATEGORIES = ["social", "entertainment"];

/** Limit fuer eine Domain, auch wenn es auf der uebergeordneten Domain sitzt. */
export function limitFor(domain, settings) {
    const limits = settings.limits || {};
    const direct = limits[domain];
    if (direct && direct.minutes > 0) return direct;

    for (const [pattern, limit] of Object.entries(limits)) {
        if (limit && limit.minutes > 0 && matchesPattern(domain, pattern)) return limit;
    }
    return null;
}

/** Faellt die Domain in den Fokusmodus? */
export function inFocusScope(domain, settings) {
    if (!focusActive(settings)) return false;

    const sites = (settings.focus && settings.focus.sites) || [];
    if (sites.length) return sites.some((pattern) => matchesPattern(domain, pattern));

    return FOCUS_DEFAULT_CATEGORIES.includes(categoryOf(domain, settings.categoryOverrides));
}

/**
 * Warum die Domain gerade gesperrt ist – oder null.
 * `snoozeUntil` kommt aus dem lokalen Speicher und schlaegt beide Gruende.
 */
export function blockReason(domain, { settings, todayMs, snoozeUntil = 0, now = Date.now() }) {
    if (!domain) return null;
    if (snoozeUntil && now < snoozeUntil) return null;

    if (inFocusScope(domain, settings)) return "focus";

    const limit = limitFor(domain, settings);
    if (limit && limit.block && todayMs >= limit.minutes * 60000) return "limit";

    return null;
}

/** URL der Sperrseite mit genug Kontext fuer eine brauchbare Meldung. */
export function blockedUrl(domain, originalUrl, reason) {
    const params = new URLSearchParams({ d: domain, r: reason });
    if (originalUrl) params.set("u", originalUrl);
    return chrome.runtime.getURL(`blocked.html?${params.toString()}`);
}

/**
 * Warnung bei X % und Meldung bei 100 % – je Tag und Domain hoechstens einmal
 * pro Stufe, sonst wird es zum Dauerfeuer.
 */
export async function checkLimitNotification(domain, todayMs, settings, now = Date.now()) {
    const limit = limitFor(domain, settings);
    if (!limit) return;

    const limitMs = limit.minutes * 60000;
    const percent = (todayMs / limitMs) * 100;
    const warnAt = Math.min(99, Math.max(1, settings.notifyAtPercent || 80));

    const level = percent >= 100 ? 100 : percent >= warnAt ? warnAt : 0;
    if (level === 0) return;
    if ((await notifiedLevel(domain, now)) >= level) return;

    const remaining = Math.max(0, limitMs - todayMs);
    const title = level === 100 ? `Limit erreicht: ${domain}` : `Bald am Limit: ${domain}`;
    const message =
        level === 100
            ? `${formatMinutes(todayMs)} von ${limit.minutes} min aufgebraucht.` +
              (limit.block ? " Die Seite wird jetzt gesperrt." : "")
            : `Noch ${formatMinutes(remaining)} von ${limit.minutes} min uebrig.`;

    await notify(`limit-${domain}-${level}`, title, message);
    await setNotifiedLevel(domain, level, now);
}

/** Benachrichtigung, die nie den Aufrufer mitreisst, wenn sie fehlschlaegt. */
export async function notify(id, title, message) {
    try {
        await chrome.notifications.create(id, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icon128.png"),
            title,
            message,
            silent: false,
        });
    } catch {
        // Benachrichtigungen koennen systemseitig abgeschaltet sein.
    }
}
