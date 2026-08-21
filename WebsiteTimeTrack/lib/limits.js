/**
 * Daily limits, notifications and blocking.
 *
 * Two paths lead to a block:
 *   1. A domain's daily limit is reached and "block" is turned on for it.
 *   2. Focus mode is running and the domain is on its list.
 * Both can be suspended briefly with a snooze, or the block becomes an
 * exercise in disabling the extension.
 */

import { categoryOf } from "./categories.js";
import { matchesPattern } from "./entity.js";
import { focusActive } from "./settings.js";
import { formatMinutes } from "./time.js";
import { notifiedLevel, setNotifiedLevel } from "./storage.js";

export const SNOOZE_MS = 5 * 60 * 1000;

/** In focus mode without its own list, these categories count as a distraction. */
const FOCUS_DEFAULT_CATEGORIES = ["social", "entertainment"];

/** The limit for a domain, even if it sits on a parent domain. */
export function limitFor(domain, settings) {
    const limits = settings.limits || {};
    const direct = limits[domain];
    if (direct && direct.minutes > 0) return direct;

    for (const [pattern, limit] of Object.entries(limits)) {
        if (limit && limit.minutes > 0 && matchesPattern(domain, pattern)) return limit;
    }
    return null;
}

/** Does the domain fall under focus mode? */
export function inFocusScope(domain, settings) {
    if (!focusActive(settings)) return false;

    const sites = (settings.focus && settings.focus.sites) || [];
    if (sites.length) return sites.some((pattern) => matchesPattern(domain, pattern));

    return FOCUS_DEFAULT_CATEGORIES.includes(categoryOf(domain, settings.categoryOverrides));
}

/**
 * Why the domain is blocked right now – or null.
 * `snoozeUntil` comes from local storage and beats both reasons.
 */
export function blockReason(domain, { settings, todayMs, snoozeUntil = 0, now = Date.now() }) {
    if (!domain) return null;
    if (snoozeUntil && now < snoozeUntil) return null;

    if (inFocusScope(domain, settings)) return "focus";

    const limit = limitFor(domain, settings);
    if (limit && limit.block && todayMs >= limit.minutes * 60000) return "limit";

    return null;
}

/** Block-page URL with enough context for a useful message. */
export function blockedUrl(domain, originalUrl, reason) {
    const params = new URLSearchParams({ d: domain, r: reason });
    if (originalUrl) params.set("u", originalUrl);
    return chrome.runtime.getURL(`blocked.html?${params.toString()}`);
}

/**
 * Warns at X % and notifies at 100 % – at most once per level, per domain,
 * per day, or this would turn into a constant stream of notifications.
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
    const title = level === 100 ? `Limit reached: ${domain}` : `Almost at the limit: ${domain}`;
    const message =
        level === 100
            ? `Used ${formatMinutes(todayMs)} of ${limit.minutes} min.` +
              (limit.block ? " The site is being blocked now." : "")
            : `${formatMinutes(remaining)} of ${limit.minutes} min left.`;

    await notify(`limit-${domain}-${level}`, title, message);
    await setNotifiedLevel(domain, level, now);
}

/** A notification that never takes the caller down with it if it fails. */
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
        // Notifications can be disabled at the OS level.
    }
}
