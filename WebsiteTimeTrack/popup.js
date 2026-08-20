/**
 * WebsiteTimeTrack – Popup
 *
 * Rendert die Balken selbst per DOM. Eine externe Chart-Bibliothek waere unter
 * der MV3-CSP ohnehin blockiert (script-src 'self'), und fuer eine sortierte
 * Balkenliste braucht es sie nicht.
 */

const RESET_CONFIRM_MS = 4000;
const REFRESH_MS = 1000;

const listEl = document.getElementById("websiteList");
const emptyEl = document.getElementById("empty");
const totalEl = document.getElementById("total");
const resetEl = document.getElementById("reset");
const rangeButtons = Array.from(document.querySelectorAll(".range"));

let currentRange = "today";
let resetArmedUntil = 0;

/* -------------------------------------------------------------------- Utils */

function dayKey(timestamp) {
    const d = new Date(timestamp);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
}

/** Kompakte Dauer: Stunden/Minuten nur wenn vorhanden. */
function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h} h ${m} min`;
    if (m > 0) return `${m} min ${s} s`;
    return `${s} s`;
}

/** Tagesschluessel, die zum gewaehlten Zeitraum gehoeren. null = alle. */
function daysInRange(range) {
    if (range === "all") return null;
    const count = range === "week" ? 7 : 1;
    const days = new Set();
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        days.add(dayKey(now - i * 24 * 60 * 60 * 1000));
    }
    return days;
}

/** Summiert die Tages-Buckets zu [domain, ms], absteigend sortiert. */
function aggregate(usage, range) {
    const days = daysInRange(range);
    const totals = new Map();

    for (const [day, bucket] of Object.entries(usage || {})) {
        if (days && !days.has(day)) continue;
        if (!bucket || typeof bucket !== "object") continue;
        for (const [domain, ms] of Object.entries(bucket)) {
            if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) continue;
            totals.set(domain, (totals.get(domain) || 0) + ms);
        }
    }

    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
}

/* ------------------------------------------------------------------- Render */

function render(entries) {
    listEl.textContent = "";

    const total = entries.reduce((sum, [, ms]) => sum + ms, 0);
    const max = entries.length ? entries[0][1] : 0;

    totalEl.textContent = total > 0 ? `Gesamt: ${formatTime(total)}` : "";
    emptyEl.hidden = entries.length > 0;

    for (const [domain, ms] of entries) {
        const li = document.createElement("li");
        li.className = "site";

        const bar = document.createElement("div");
        bar.className = "bar";
        // Relativ zur groessten Domain – so bleibt der Vergleich auch bei
        // sehr unterschiedlichen Werten lesbar.
        bar.style.width = `${max > 0 ? (ms / max) * 100 : 0}%`;

        const label = document.createElement("span");
        label.className = "name";
        label.textContent = domain;
        label.title = domain;

        const value = document.createElement("span");
        value.className = "value";
        value.textContent = formatTime(ms);

        li.append(bar, label, value);
        listEl.appendChild(li);
    }
}

/** Service Worker abrechnen lassen, damit die laufende Sitzung mitzaehlt. */
function requestSync() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: "sync" }, () => {
                void chrome.runtime.lastError; // Worker evtl. nicht erreichbar – egal.
                resolve();
            });
        } catch {
            resolve();
        }
    });
}

async function refresh() {
    await requestSync();
    const { usage } = await chrome.storage.local.get("usage");
    render(aggregate(usage, currentRange));
}

/* ------------------------------------------------------------------ Actions */

function selectRange(range) {
    currentRange = range;
    for (const button of rangeButtons) {
        const selected = button.dataset.range === range;
        button.setAttribute("aria-selected", String(selected));
    }
    refresh();
}

for (const button of rangeButtons) {
    button.addEventListener("click", () => selectRange(button.dataset.range));
}

// Zweistufig statt confirm(): ein Fehlklick soll nicht alle Daten loeschen,
// und confirm() schliesst in Popups gerne das ganze Fenster.
resetEl.addEventListener("click", async () => {
    if (Date.now() > resetArmedUntil) {
        resetArmedUntil = Date.now() + RESET_CONFIRM_MS;
        resetEl.textContent = "Wirklich? Nochmal klicken";
        resetEl.classList.add("armed");
        setTimeout(() => {
            if (Date.now() > resetArmedUntil) return;
            resetArmedUntil = 0;
            resetEl.textContent = "Zuruecksetzen";
            resetEl.classList.remove("armed");
        }, RESET_CONFIRM_MS);
        return;
    }

    resetArmedUntil = 0;
    resetEl.textContent = "Zuruecksetzen";
    resetEl.classList.remove("armed");
    await chrome.storage.local.set({ usage: {} });
    refresh();
});

selectRange(currentRange);
const refreshTimer = setInterval(refresh, REFRESH_MS);
window.addEventListener("unload", () => clearInterval(refreshTimer));
