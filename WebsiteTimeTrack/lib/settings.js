/**
 * Settings live in chrome.storage.sync, so they travel to every device signed
 * into the same browser profile without any extra work. Without sign-in,
 * Chrome falls back to local storage – the extension works exactly the same,
 * just without cross-device sync.
 */

export const DEFAULTS = {
    // Appearance
    theme: "auto", // "auto" | "light" | "dark"

    // Measurement
    idleSeconds: 60,
    requireInteraction: false,
    interactionTimeoutSeconds: 90,
    audibleCountsAsActive: true,

    // Capture
    trackSubEntities: true,
    genericSubEntityDomains: [],
    ignore: [],

    // Categories
    categoryOverrides: {},

    // Limits: { "youtube.com": { minutes: 60, block: false } }
    limits: {},
    notifyAtPercent: 80,

    // Focus mode
    focus: { active: false, until: 0, sites: [] },

    // Report & sync
    weeklyReport: true,
    syncUsage: false,
    syncDays: 14,
};

/** Deep-merges stored settings with the defaults so new fields never go missing. */
function withDefaults(stored = {}) {
    const merged = { ...DEFAULTS, ...stored };
    merged.focus = { ...DEFAULTS.focus, ...(stored.focus || {}) };
    merged.limits = { ...(stored.limits || {}) };
    merged.categoryOverrides = { ...(stored.categoryOverrides || {}) };
    merged.ignore = Array.isArray(stored.ignore) ? stored.ignore : [];
    merged.genericSubEntityDomains = Array.isArray(stored.genericSubEntityDomains)
        ? stored.genericSubEntityDomains
        : [];
    return merged;
}

export async function getSettings() {
    try {
        const { settings } = await chrome.storage.sync.get("settings");
        return withDefaults(settings);
    } catch {
        // storage.sync can fail on some profiles (quota, not signed in).
        const { settings } = await chrome.storage.local.get("settings");
        return withDefaults(settings);
    }
}

export async function saveSettings(patch) {
    const current = await getSettings();
    const next = withDefaults({ ...current, ...patch });
    try {
        await chrome.storage.sync.set({ settings: next });
    } catch {
        await chrome.storage.local.set({ settings: next });
    }
    return next;
}

/** Is focus mode actually active right now? (accounts for its expiry time) */
export function focusActive(settings, now = Date.now()) {
    const focus = settings.focus || {};
    if (!focus.active) return false;
    if (focus.until && now > focus.until) return false;
    return true;
}
