/**
 * Kategorien und Produktivitaets-Score.
 *
 * Die Gewichte sind bewusst grob: der Score soll einen Trend zeigen, keine
 * Wahrheit behaupten. Wer Reddit beruflich liest, verschiebt die Domain auf
 * der Optionsseite in eine andere Kategorie.
 */

import { matchesPattern } from "./entity.js";

export const CATEGORIES = {
    work: { label: "Arbeit", weight: 1, color: "#3fa96b" },
    learning: { label: "Lernen", weight: 1, color: "#4b9fe1" },
    news: { label: "News", weight: 0.2, color: "#c9a227" },
    shopping: { label: "Shopping", weight: -0.3, color: "#c97fb5" },
    social: { label: "Social", weight: -0.7, color: "#e08a3c" },
    entertainment: { label: "Unterhaltung", weight: -1, color: "#d9534f" },
    other: { label: "Sonstiges", weight: 0, color: "#8b93a1" },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

/** Startzuordnung. Nutzer-Overrides aus den Einstellungen stechen sie aus. */
export const DEFAULT_MAP = {
    work: [
        "github.com", "gitlab.com", "stackoverflow.com", "stackexchange.com",
        "atlassian.net", "jira.com", "confluence.com", "notion.so", "slack.com",
        "linear.app", "figma.com", "docs.google.com", "drive.google.com",
        "sheets.google.com", "office.com", "outlook.com", "sharepoint.com",
        "onedrive.live.com", "teams.microsoft.com", "zoom.us", "asana.com",
        "trello.com", "vercel.com", "netlify.com", "aws.amazon.com",
        "console.cloud.google.com", "portal.azure.com", "npmjs.com",
        "developer.mozilla.org", "chatgpt.com", "claude.ai",
    ],
    learning: [
        "wikipedia.org", "coursera.org", "udemy.com", "edx.org", "khanacademy.org",
        "duolingo.com", "leetcode.com", "codecademy.com", "arxiv.org",
        "scholar.google.com", "w3schools.com", "freecodecamp.org",
    ],
    news: [
        "spiegel.de", "zeit.de", "faz.net", "sueddeutsche.de", "heise.de",
        "golem.de", "tagesschau.de", "orf.at", "derstandard.at", "krone.at",
        "bbc.com", "nytimes.com", "theguardian.com", "reuters.com",
        "news.ycombinator.com", "lobste.rs",
    ],
    shopping: [
        "amazon.com", "amazon.de", "ebay.com", "ebay.de", "aliexpress.com",
        "zalando.de", "otto.de", "willhaben.at", "temu.com", "etsy.com",
        "mediamarkt.de", "saturn.de", "idealo.de", "geizhals.at",
    ],
    social: [
        "facebook.com", "instagram.com", "x.com", "twitter.com", "reddit.com",
        "tiktok.com", "linkedin.com", "snapchat.com", "pinterest.com",
        "discord.com", "whatsapp.com", "web.whatsapp.com", "threads.net",
        "mastodon.social", "bsky.app", "9gag.com",
    ],
    entertainment: [
        "youtube.com", "netflix.com", "twitch.tv", "disneyplus.com",
        "primevideo.com", "spotify.com", "soundcloud.com", "hulu.com",
        "crunchyroll.com", "steampowered.com", "epicgames.com", "roblox.com",
        "imdb.com", "wakanim.tv", "joyn.de", "rtlplus.de",
    ],
};

// Domain -> Kategorie, einmal aufgebaut statt bei jedem Aufruf.
const LOOKUP = new Map();
for (const [category, domains] of Object.entries(DEFAULT_MAP)) {
    for (const domain of domains) LOOKUP.set(domain, category);
}

/** Kategorie einer Domain: erst Nutzer-Override, dann Standardliste. */
export function categoryOf(domain, overrides = {}) {
    if (!domain) return "other";

    const override = overrides[domain];
    if (override && CATEGORIES[override]) return override;

    // Overrides duerfen auch Subdomains abdecken ("example.com" -> "a.example.com").
    for (const [pattern, category] of Object.entries(overrides)) {
        if (CATEGORIES[category] && matchesPattern(domain, pattern)) return category;
    }

    const direct = LOOKUP.get(domain);
    if (direct) return direct;

    // Subdomains auf die Standardliste zurueckfuehren (z.B. "de.wikipedia.org").
    for (const [known, category] of LOOKUP) {
        if (matchesPattern(domain, known)) return category;
    }
    return "other";
}

/** Summiert [domain, ms] zu Millisekunden je Kategorie. */
export function totalsByCategory(entries, overrides = {}) {
    const totals = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0]));
    for (const [domain, ms] of entries) {
        totals[categoryOf(domain, overrides)] += ms;
    }
    return totals;
}

/**
 * Produktivitaets-Score 0–100. 50 ist neutral, darueber ueberwiegen Arbeit und
 * Lernen, darunter Social und Unterhaltung. Ohne Daten gibt es keinen Score.
 */
export function productivityScore(categoryTotals) {
    let total = 0;
    let weighted = 0;
    for (const [key, ms] of Object.entries(categoryTotals)) {
        if (!CATEGORIES[key] || ms <= 0) continue;
        total += ms;
        weighted += ms * CATEGORIES[key].weight;
    }
    if (total === 0) return null;
    return Math.round(Math.min(100, Math.max(0, 50 + (weighted / total) * 50)));
}

/** Einordnung des Scores in Worte. */
export function scoreLabel(score) {
    if (score === null) return "";
    if (score >= 75) return "sehr produktiv";
    if (score >= 60) return "produktiv";
    if (score >= 40) return "gemischt";
    if (score >= 25) return "viel Ablenkung";
    return "kaum Fokus";
}
