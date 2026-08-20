/**
 * Domain- und Unterobjekt-Erkennung.
 *
 * Reine Domain-Statistik ist grob: "youtube.com 4 h" sagt wenig, "youtube.com /
 * Kanal Kurzgesagt 40 min" schon mehr. Wo sich das Unterobjekt aus der URL
 * ablesen laesst, passiert das hier. YouTube-Videoseiten tragen den Kanalnamen
 * nicht in der URL – den liefert das Content-Script nach.
 */

/** Hostname einer trackbaren URL, sonst null. */
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

/** Pfadsegmente ohne leere Teile. */
function segments(pathname) {
    return pathname.split("/").filter(Boolean);
}

const EXTRACTORS = {
    "youtube.com": (parts) => {
        if (parts[0] && parts[0].startsWith("@")) return { kind: "Kanal", label: parts[0] };
        if (["c", "user", "channel"].includes(parts[0]) && parts[1]) {
            return { kind: "Kanal", label: parts[1] };
        }
        return null; // /watch – kommt aus dem Content-Script.
    },
    "github.com": (parts) => {
        const reserved = new Set([
            "settings", "notifications", "explore", "marketplace", "pulls",
            "issues", "search", "orgs", "topics", "sponsors", "codespaces",
        ]);
        if (parts.length >= 2 && !reserved.has(parts[0])) {
            return { kind: "Repo", label: `${parts[0]}/${parts[1]}` };
        }
        return null;
    },
    "gitlab.com": (parts) =>
        parts.length >= 2 && !parts[0].startsWith("-")
            ? { kind: "Repo", label: `${parts[0]}/${parts[1]}` }
            : null,
    "reddit.com": (parts) =>
        parts[0] === "r" && parts[1] ? { kind: "Subreddit", label: `r/${parts[1]}` } : null,
    "twitch.tv": (parts) => {
        const reserved = new Set(["directory", "settings", "videos", "search", "subscriptions"]);
        return parts[0] && !reserved.has(parts[0]) ? { kind: "Kanal", label: parts[0] } : null;
    },
    "x.com": (parts) => {
        const reserved = new Set(["home", "explore", "notifications", "messages", "settings", "i", "search"]);
        return parts[0] && !reserved.has(parts[0]) ? { kind: "Profil", label: `@${parts[0]}` } : null;
    },
    "stackoverflow.com": (parts) =>
        parts[0] === "questions" && parts[2] ? { kind: "Frage", label: parts[2].slice(0, 60) } : null,
};

EXTRACTORS["twitter.com"] = EXTRACTORS["x.com"];

/**
 * Unterobjekt aus der URL, sonst null.
 * `genericDomains` erlaubt es, fuer beliebige Domains das erste Pfadsegment
 * als Unterobjekt zu nehmen (Einstellung auf der Optionsseite).
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
        return { kind: "Bereich", label: `/${parts[0]}` };
    }
    return null;
}

/** Ist das eine YouTube-Videoseite? Dann liefert das Content-Script den Kanal. */
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
 * Prueft eine Domain gegen Ignorier-/Blockmuster.
 * Unterstuetzt exakte Domains, Subdomains (`example.com` trifft `a.example.com`)
 * und fuehrende Wildcards (`*.intern.example`).
 */
export function matchesPattern(domain, pattern) {
    if (!domain || !pattern) return false;
    const clean = String(pattern).trim().toLowerCase().replace(/^\*\./, "").replace(/^www\./, "");
    if (!clean) return false;
    const target = domain.toLowerCase();
    return target === clean || target.endsWith(`.${clean}`);
}

/** Trifft die Domain irgendeines der Muster? */
export function matchesAny(domain, patterns = []) {
    return patterns.some((pattern) => matchesPattern(domain, pattern));
}
