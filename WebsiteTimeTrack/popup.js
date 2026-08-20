/**
 * Popup.
 *
 * Rendert alles selbst per DOM. Eine externe Chart-Bibliothek waere unter der
 * MV3-CSP ohnehin blockiert (script-src 'self') und fuer Balkenlisten nicht
 * noetig.
 */

import { formatDuration, lastDays, shortDayLabel } from "./lib/time.js";
import {
    aggregate, aggregateDetail, clearAll, clearDomain, dailyTotals, getDetail, serialize,
} from "./lib/storage.js";
import { CATEGORIES, categoryOf, productivityScore, scoreLabel, totalsByCategory } from "./lib/categories.js";
import { getSettings, saveSettings, focusActive } from "./lib/settings.js";
import { usageForDisplay } from "./lib/sync.js";

const REFRESH_MS = 1000;
const CONFIRM_MS = 4000;
const FOCUS_DURATION_MINUTES = 60;

const el = (id) => document.getElementById(id);
const siteList = el("siteList");
const categoryList = el("categoryList");
const historyBox = el("history");
const emptyEl = el("empty");

let range = "today";
let view = "sites";
let settings = null;
let expanded = null; // Domain, deren Unterobjekte aufgeklappt sind.
let resetArmedUntil = 0;

/* -------------------------------------------------------------------- Daten */

function daysFor(current) {
    if (current === "all") return null;
    return lastDays({ today: 1, week: 7, month: 30 }[current] || 1);
}

/* ------------------------------------------------------------------ Favicon */

/**
 * Chrome liefert Favicons ueber die `favicon`-Berechtigung aus dem eigenen
 * Cache – ohne Netzwerkzugriff. Wo das fehlschlaegt (Firefox, unbekannte
 * Domain), tritt der Buchstabenkreis an die Stelle.
 */
function faviconNode(domain) {
    const fallback = document.createElement("span");
    fallback.className = "favicon fallback";
    fallback.textContent = domain.charAt(0).toUpperCase();
    // Aus dem Domainnamen abgeleiteter Farbton – stabil und ohne Zufall.
    let hash = 0;
    for (const char of domain) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    fallback.style.background = `hsl(${hash} 45% 45%)`;

    let url;
    try {
        url = new URL(chrome.runtime.getURL("/_favicon/"));
        url.searchParams.set("pageUrl", `https://${domain}`);
        url.searchParams.set("size", "32");
    } catch {
        return fallback;
    }

    const img = document.createElement("img");
    img.className = "favicon";
    img.src = url.toString();
    img.alt = "";
    img.addEventListener("error", () => img.replaceWith(fallback), { once: true });
    return img;
}

/* ------------------------------------------------------------ Seitenansicht */

function renderSites(entries, detail, days) {
    siteList.textContent = "";
    const max = entries.length ? entries[0][1] : 0;

    for (const [domain, ms] of entries) {
        const li = document.createElement("li");
        li.className = "site";

        const row = document.createElement("div");
        row.className = "site-row";

        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.width = `${max > 0 ? (ms / max) * 100 : 0}%`;

        const category = categoryOf(domain, settings.categoryOverrides);
        bar.style.background = `${CATEGORIES[category].color}33`;

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = domain;
        name.title = `${domain} · ${CATEGORIES[category].label}`;

        const value = document.createElement("span");
        value.className = "value";
        value.textContent = formatDuration(ms);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove";
        remove.title = `${domain} loeschen`;
        remove.textContent = "×";
        remove.addEventListener("click", (event) => {
            event.stopPropagation();
            confirmRemove(remove, domain);
        });

        row.append(bar, faviconNode(domain), name, value, remove);

        const subEntries = aggregateDetail(detail, domain, days);
        if (subEntries.length) {
            row.classList.add("expandable");
            row.addEventListener("click", () => {
                expanded = expanded === domain ? null : domain;
                refresh();
            });
        }

        li.appendChild(row);

        if (expanded === domain && subEntries.length) {
            const sub = document.createElement("ul");
            sub.className = "subentities";
            for (const [label, subMs] of subEntries.slice(0, 8)) {
                const subLi = document.createElement("li");
                const subName = document.createElement("span");
                subName.className = "name";
                subName.textContent = label;
                const subValue = document.createElement("span");
                subValue.className = "value";
                subValue.textContent = formatDuration(subMs);
                subLi.append(subName, subValue);
                sub.appendChild(subLi);
            }
            li.appendChild(sub);
        }
        siteList.appendChild(li);
    }
}

/** Zweistufiges Loeschen – ein Fehlklick soll keine Woche Daten kosten. */
function confirmRemove(button, domain) {
    if (button.dataset.armed !== "1") {
        button.dataset.armed = "1";
        button.textContent = "Sicher?";
        button.classList.add("armed");
        setTimeout(() => {
            button.dataset.armed = "";
            button.textContent = "×";
            button.classList.remove("armed");
        }, CONFIRM_MS);
        return;
    }
    serialize(() => clearDomain(domain)).then(refresh);
}

/* ----------------------------------------------------------- Verlaufsansicht */

function renderHistory(usage) {
    historyBox.textContent = "";
    const days = lastDays(30).reverse();
    const totals = dailyTotals(usage, days);
    const max = Math.max(...Object.values(totals), 1);

    const chart = document.createElement("div");
    chart.className = "chart";

    for (const day of days) {
        const column = document.createElement("div");
        column.className = "column";
        column.title = `${shortDayLabel(day)} – ${formatDuration(totals[day])}`;

        const fill = document.createElement("div");
        fill.className = "column-fill";
        // Mindesthoehe, damit auch kurze Tage sichtbar bleiben.
        fill.style.height = totals[day] > 0 ? `${Math.max(3, (totals[day] / max) * 100)}%` : "0";
        column.appendChild(fill);
        chart.appendChild(column);
    }

    const scale = document.createElement("div");
    scale.className = "chart-scale";
    scale.append(
        Object.assign(document.createElement("span"), { textContent: shortDayLabel(days[0]) }),
        Object.assign(document.createElement("span"), { textContent: formatDuration(max) + " max" }),
        Object.assign(document.createElement("span"), { textContent: "heute" }),
    );

    historyBox.append(chart, scale);
}

/* --------------------------------------------------------- Kategorieansicht */

function renderCategories(entries) {
    categoryList.textContent = "";
    const totals = totalsByCategory(entries, settings.categoryOverrides);
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    if (sum <= 0) return;

    const sorted = Object.entries(totals)
        .filter(([, ms]) => ms > 0)
        .sort((a, b) => b[1] - a[1]);

    for (const [key, ms] of sorted) {
        const li = document.createElement("li");
        li.className = "category";

        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.width = `${(ms / sum) * 100}%`;
        bar.style.background = `${CATEGORIES[key].color}44`;

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = CATEGORIES[key].label;

        const value = document.createElement("span");
        value.className = "value";
        value.textContent = `${Math.round((ms / sum) * 100)} % · ${formatDuration(ms)}`;

        li.append(bar, name, value);
        categoryList.appendChild(li);
    }
}

/* ------------------------------------------------------------------ Refresh */

async function refresh() {
    settings = await getSettings();

    // Der Service Worker rechnet erst ab, dann lesen wir – sonst fehlt die
    // laufende Minute.
    await new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: "sync" }, () => {
                void chrome.runtime.lastError;
                resolve();
            });
        } catch {
            resolve();
        }
    });

    const usage = await usageForDisplay(settings);
    const detail = await getDetail();
    const days = daysFor(range);
    const entries = aggregate(usage, days);
    const total = entries.reduce((sum, [, ms]) => sum + ms, 0);

    el("total").textContent = total > 0 ? formatDuration(total) : "";

    const score = productivityScore(totalsByCategory(entries, settings.categoryOverrides));
    const scoreEl = el("score");
    if (score === null) {
        scoreEl.hidden = true;
    } else {
        scoreEl.hidden = false;
        scoreEl.textContent = `Score ${score}`;
        scoreEl.title = `Produktivitaet: ${scoreLabel(score)}`;
        scoreEl.style.background = `hsl(${Math.round(score * 1.2)} 55% 42%)`;
    }

    const active = focusActive(settings);
    el("focus").classList.toggle("on", active);
    el("focus").textContent = active ? "Fokus an" : "Fokus";

    siteList.hidden = view !== "sites";
    historyBox.hidden = view !== "history";
    categoryList.hidden = view !== "categories";
    emptyEl.hidden = entries.length > 0;

    if (view === "sites") renderSites(entries, detail, days);
    if (view === "history") renderHistory(usage);
    if (view === "categories") renderCategories(entries);
}

/* ------------------------------------------------------------------ Bedienung */

el("ranges").addEventListener("click", (event) => {
    const button = event.target.closest("[data-range]");
    if (!button) return;
    range = button.dataset.range;
    expanded = null;
    for (const tab of el("ranges").querySelectorAll(".tab")) {
        tab.setAttribute("aria-selected", String(tab === button));
    }
    refresh();
});

el("views").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    view = button.dataset.view;
    for (const tab of el("views").querySelectorAll(".tab")) {
        tab.setAttribute("aria-selected", String(tab === button));
    }
    refresh();
});

el("focus").addEventListener("click", async () => {
    const active = focusActive(settings);
    await saveSettings({
        focus: {
            ...settings.focus,
            active: !active,
            until: active ? 0 : Date.now() + FOCUS_DURATION_MINUTES * 60000,
        },
    });
    await chrome.runtime.sendMessage({ type: "settingsChanged" });
    refresh();
});

el("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

el("reset").addEventListener("click", async () => {
    const button = el("reset");
    if (Date.now() > resetArmedUntil) {
        resetArmedUntil = Date.now() + CONFIRM_MS;
        button.textContent = "Wirklich? Nochmal klicken";
        setTimeout(() => {
            if (Date.now() > resetArmedUntil) return;
            resetArmedUntil = 0;
            button.textContent = "Alles zuruecksetzen";
        }, CONFIRM_MS);
        return;
    }
    resetArmedUntil = 0;
    button.textContent = "Alles zuruecksetzen";
    await serialize(() => clearAll());
    refresh();
});

refresh();
const timer = setInterval(refresh, REFRESH_MS);
addEventListener("unload", () => clearInterval(timer));
