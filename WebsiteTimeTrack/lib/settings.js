/**
 * Einstellungen liegen in chrome.storage.sync und wandern damit ohne weiteres
 * Zutun auf alle Geraete, an denen dasselbe Browserprofil angemeldet ist.
 * Ohne Anmeldung faellt Chrome auf lokalen Speicher zurueck – die Extension
 * funktioniert dann genauso, nur eben ohne Abgleich.
 */

export const DEFAULTS = {
    // Messung
    idleSeconds: 60,
    requireInteraction: false,
    interactionTimeoutSeconds: 90,
    audibleCountsAsActive: true,

    // Erfassung
    trackSubEntities: true,
    genericSubEntityDomains: [],
    ignore: [],

    // Kategorien
    categoryOverrides: {},

    // Limits: { "youtube.com": { minutes: 60, block: false } }
    limits: {},
    notifyAtPercent: 80,

    // Fokusmodus
    focus: { active: false, until: 0, sites: [] },

    // Report & Sync
    weeklyReport: true,
    syncUsage: false,
    syncDays: 14,
};

/** Tiefe Zusammenfuehrung mit den Defaults, damit neue Felder nie fehlen. */
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
        // storage.sync kann in manchen Profilen fehlschlagen (Quota, kein Login).
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

/** Ist der Fokusmodus gerade wirklich aktiv? (Ablaufzeit mitgeprueft) */
export function focusActive(settings, now = Date.now()) {
    const focus = settings.focus || {};
    if (!focus.active) return false;
    if (focus.until && now > focus.until) return false;
    return true;
}
