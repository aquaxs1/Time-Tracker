/**
 * Domain and sub-entity detection.
 *
 * Plain domain stats are coarse: "youtube.com 4 h" says little, "youtube.com /
 * Channel Kurzgesagt 40 min" says a lot more. Where a sub-entity can be read
 * straight off the URL, this is where that happens. YouTube video pages don't
 * carry the channel name in the URL – the content script supplies that.
 */

/** Hostname of a trackable URL, or null. */
export function domainOf(url) {
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

/** Path segments with empty parts removed. */
function segments(pathname) {
    return pathname.split("/").filter(Boolean);
}

const EXTRACTORS = {
    "youtube.com": (parts) => {
        if (parts[0] && parts[0].startsWith("@")) return { kind: "Channel", label: parts[0] };
        if (["c", "user", "channel"].includes(parts[0]) && parts[1]) {
            return { kind: "Channel", label: parts[1] };
        }
        return null; // /watch – comes from the content script instead.
    },
    "github.com": (parts) => {
        const reserved = new Set([
            "settings", "notifications", "explore", "marketplace", "pulls",
            "issues", "search", "orgs", "topics", "sponsors", "codespaces",
        ]);
        if (parts.length >= 2 && !reserved.has(parts[0])) {
            return { kind: "Repository", label: `${parts[0]}/${parts[1]}` };
        }
        return null;
    },
    "gitlab.com": (parts) =>
        parts.length >= 2 && !parts[0].startsWith("-")
            ? { kind: "Repository", label: `${parts[0]}/${parts[1]}` }
            : null,
    "reddit.com": (parts) =>
        parts[0] === "r" && parts[1] ? { kind: "Subreddit", label: `r/${parts[1]}` } : null,
    "twitch.tv": (parts) => {
        const reserved = new Set(["directory", "settings", "videos", "search", "subscriptions"]);
        return parts[0] && !reserved.has(parts[0]) ? { kind: "Channel", label: parts[0] } : null;
    },
    "x.com": (parts) => {
        const reserved = new Set(["home", "explore", "notifications", "messages", "settings", "i", "search"]);
        return parts[0] && !reserved.has(parts[0]) ? { kind: "Profile", label: `@${parts[0]}` } : null;
    },
    "stackoverflow.com": (parts) =>
        parts[0] === "questions" && parts[2] ? { kind: "Question", label: parts[2].slice(0, 60) } : null,
};

EXTRACTORS["twitter.com"] = EXTRACTORS["x.com"];

/**
 * Sub-entity read from the URL, or null.
 * `genericDomains` lets any domain use its first path segment as a sub-entity
 * (a setting on the options page).
 */
export function subEntityOf(url, genericDomains = []) {
    const domain = domainOf(url);
    if (!domain) return null;

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const parts = segments(parsed.pathname);

    const extractor = EXTRACTORS[domain];
    if (extractor) {
        try {
            return extractor(parts);
        } catch {
            return null;
        }
    }

    if (genericDomains.includes(domain) && parts[0]) {
        return { kind: "Section", label: `/${parts[0]}` };
    }
    return null;
}

/** Is this a YouTube video page? Then the content script supplies the channel. */
export function needsPageLookup(url) {
    const domain = domainOf(url);
    if (domain !== "youtube.com") return false;
    try {
        return new URL(url).pathname === "/watch";
    } catch {
        return false;
    }
}

/**
 * Checks a domain against ignore/block patterns.
 * Supports exact domains, subdomains (`example.com` matches `a.example.com`),
 * and leading wildcards (`*.intern.example`).
 */
export function matchesPattern(domain, pattern) {
    if (!domain || !pattern) return false;
    const clean = String(pattern).trim().toLowerCase().replace(/^\*\./, "").replace(/^www\./, "");
    if (!clean) return false;
    const target = domain.toLowerCase();
    return target === clean || target.endsWith(`.${clean}`);
}

/** Does the domain match any of the patterns? */
export function matchesAny(domain, patterns = []) {
    return patterns.some((pattern) => matchesPattern(domain, pattern));
}
