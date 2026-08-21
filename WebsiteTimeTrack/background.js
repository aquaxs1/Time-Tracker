/**
 * WebsiteTimeTrack – service worker
 *
 * Time isn't ticked up by a timer; it's measured as segments: on every event
 * that can change the active page (tab switch, URL change, window focus,
 * idle, interaction), the running segment is booked and a new one starts. An
 * alarm firing once a minute wakes the service worker and flushes in between,
 * so long sessions survive too.
 *
 * All state lives in chrome.storage.session: MV3 shuts the service worker
 * down after a short idle period, and module-scope variables would be gone.
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

// Segments longer than this aren't real browsing – they're standby / sleep,
// where neither the alarm nor an idle event fires. Discarded.
const MAX_SEGMENT_MS = 5 * 60 * 1000;

/* -------------------------------------------------------------- Settings cache */

// Settings are needed on every event. The cache lives only as long as the
// service worker and is dropped immediately on any change.
let settingsCache = null;

async function settings() {
    if (!settingsCache) settingsCache = await getSettings();
    return settingsCache;
}

chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === "sync" || area === "local") && changes.settings) settingsCache = null;
});

/* ---------------------------------------------------------------- Session state */

async function sessionState() {
    const state = await chrome.storage.session.get(["active", "lastInteraction", "tabEntity"]);
    return {
        active: state.active || null,
        lastInteraction: state.lastInteraction || 0,
        tabEntity: state.tabEntity || {},
    };
}

/* --------------------------------------------------------------------- Capture */

/**
 * What's counting right now – or null.
 * Conditions: the user isn't idle, a Chrome window is in the foreground, the
 * URL is trackable, it's not on the ignore list, and – if required – there
 * was an interaction in the recent past.
 */
async function currentTarget(now) {
    const config = await settings();

    try {
        const idleState = await chrome.idle.queryState(config.idleSeconds);
        if (idleState !== "active") return null;

        // No focused Chrome window => the user is in a different app.
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
            // A playing video is usage too, even without a mouse or key press.
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
        // A window/tab can disappear between calls – then there's just nothing.
        return null;
    }
}

/** Sub-entity from the URL, or from the content script for YouTube videos. */
async function entityFor(tab, config) {
    if (!config.trackSubEntities) return null;

    const fromUrl = subEntityOf(tab.url, config.genericSubEntityDomains);
    if (fromUrl) return `${fromUrl.kind}: ${fromUrl.label}`;

    if (needsPageLookup(tab.url)) {
        const { tabEntity } = await sessionState();
        const label = tabEntity[String(tab.id)];
        if (label) return `Channel: ${label}`;
    }
    return null;
}

/**
 * The latest point in time the running segment may be booked to.
 *
 * Two cases where "now" is too late:
 *  - The idle state is only reported after the threshold has elapsed. The
 *    user was already inactive before that.
 *  - With `requireInteraction`, usage ends with the interaction window, not
 *    only at the next alarm.
 * Without this cap, both would get credited to the last visited page.
 */
async function segmentDeadline(now, config, active, wentIdle) {
    let deadline = now;

    if (wentIdle) deadline = Math.min(deadline, now - config.idleSeconds * 1000);

    // An audible tab counts as usage, no interaction needed.
    const audibleExempt = config.audibleCountsAsActive && active && active.audible;
    if (config.requireInteraction && !audibleExempt) {
        const { lastInteraction } = await sessionState();
        deadline = Math.min(deadline, lastInteraction + config.interactionTimeoutSeconds * 1000);
    }
    return deadline;
}

/** Books the running segment (at most up to `until`). */
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
 * Core routine: book the running segment, then work out what's active now.
 * Called by every event and by the alarm.
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

        // Check only after booking, or the warning would lag a round behind.
        const domain = settledDomain || (target && target.domain);
        if (domain) await checkLimits(domain, now);
    });
}

/** Limit warning and – once due – blocking. */
async function checkLimits(domain, now) {
    const config = await settings();
    const usage = await getUsage();
    const todayMs = (usage[dayKey(now)] || {})[domain] || 0;

    await checkLimitNotification(domain, todayMs, config, now);
    await enforce(config, now);
}

/* ---------------------------------------------------------------------- Block */

/** Redirects every tab on a blocked domain to the block page. */
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
        // Individual tabs can disappear – no reason to abort the rest.
    }
}

/* --------------------------------------------------------------------- Events */

chrome.tabs.onActivated.addListener(() => tick());
chrome.tabs.onRemoved.addListener((tabId) => {
    forgetTab(tabId);
    tick();
});
chrome.windows.onFocusChanged.addListener(() => tick());
chrome.idle.onStateChanged.addListener((state) => tick({ wentIdle: state !== "active" }));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url) return;
    forgetTab(tabId); // New page, the old channel name no longer applies.
    if (tab.active) tick();
    else settings().then((config) => enforce(config)); // Block background tabs too.
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

/* ------------------------------------------------------------------- Messages */

const handlers = {
    /** The popup asks for a flush before rendering, so running time is included. */
    async sync() {
        await tick();
        return { ok: true };
    },

    /** The content script reports a mouse, keyboard or scroll event. */
    async interaction() {
        await chrome.storage.session.set({ lastInteraction: Date.now() });
        const config = await settings();
        // Without the option, an interaction doesn't change the result.
        if (config.requireInteraction) await tick();
        return { ok: true };
    },

    /** The content script supplies the channel name of a YouTube video page. */
    async entity(message, sender) {
        if (!sender.tab || !message.label) return { ok: false };
        const { tabEntity } = await sessionState();
        tabEntity[String(sender.tab.id)] = String(message.label).slice(0, 80);
        await chrome.storage.session.set({ tabEntity });
        await tick();
        return { ok: true };
    },

    /** The block page asks for a brief exception. */
    async snooze(message) {
        if (!message.domain) return { ok: false };
        await setSnooze(message.domain, Date.now() + SNOOZE_MS);
        return { ok: true, until: Date.now() + SNOOZE_MS };
    },

    /** The options page changed a setting – apply it right away. */
    async settingsChanged() {
        settingsCache = null;
        const config = await settings();
        chrome.idle.setDetectionInterval(config.idleSeconds);
        await enforce(config);
        return { ok: true };
    },

    /** The options page triggers a manual device sync. */
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
    return true; // The reply arrives asynchronously.
});

/* ------------------------------------------------------------------- Maintenance */

/** Hourly: clean up, check the weekly report, write the device sync. */
async function maintenance() {
    try {
        const config = await settings();
        await serialize(() => prune());
        await maybeCreateWeeklyReport(config);
        if (config.syncUsage) await sync.push(config.syncDays);
    } catch {
        // Maintenance must never stop tracking.
    }
}

/* ----------------------------------------------------------------------- Startup */

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

// The service worker also restarts outside of those two events (e.g. after an
// idle shutdown). The active tab must be picked up again immediately, or
// nothing counts until the user switches tabs.
tick();
