/** Optionsseite: alle Einstellungen, Kategoriezuordnung, Report und Datenexport. */

import { formatDuration, formatMinutes } from "./lib/time.js";
import { aggregate, getReports, getUsage } from "./lib/storage.js";
import { CATEGORIES, CATEGORY_KEYS, categoryOf } from "./lib/categories.js";
import { getSettings, saveSettings } from "./lib/settings.js";
import { download, importJSON, toCSV, toJSON } from "./lib/export.js";
import * as sync from "./lib/sync.js";
import { reportSummary } from "./lib/report.js";

const el = (id) => document.getElementById(id);
const CATEGORY_ROW_LIMIT = 40;

let settings = null;

/* ------------------------------------------------------------------ Helfer */

function linesToList(text) {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

let savedTimer = null;
function flashSaved() {
    const badge = el("saved");
    badge.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (badge.hidden = true), 1500);
}

/** Schreibt die Einstellungen und laesst den Service Worker sofort reagieren. */
async function persist(patch) {
    settings = await saveSettings(patch);
    try {
        await chrome.runtime.sendMessage({ type: "settingsChanged" });
    } catch {
        // Service Worker startet gleich von selbst neu.
    }
    flashSaved();
}

function status(id, message, isError = false) {
    const node = el(id);
    node.textContent = message;
    node.classList.toggle("error", isError);
    setTimeout(() => {
        if (node.textContent === message) node.textContent = "";
    }, 6000);
}

/** Lokale Zeit als Wert fuer <input type="datetime-local">. */
function toLocalInput(timestamp) {
    if (!timestamp) return "";
    const d = new Date(timestamp - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
}

/* ---------------------------------------------------------------- Limits */

function renderLimits() {
    const body = el("limitRows");
    body.textContent = "";

    const entries = Object.entries(settings.limits).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) {
        const row = body.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 4;
        cell.className = "muted";
        cell.textContent = "Noch keine Limits gesetzt.";
        return;
    }

    for (const [domain, limit] of entries) {
        const row = body.insertRow();
        row.insertCell().textContent = domain;

        const minutesCell = row.insertCell();
        const minutes = document.createElement("input");
        minutes.type = "number";
        minutes.min = "1";
        minutes.max = "1440";
        minutes.value = limit.minutes;
        minutes.addEventListener("change", () => {
            const value = Math.max(1, Number(minutes.value) || 1);
            persist({ limits: { ...settings.limits, [domain]: { ...limit, minutes: value } } })
                .then(renderLimits);
        });
        minutesCell.appendChild(minutes);

        const blockCell = row.insertCell();
        const block = document.createElement("input");
        block.type = "checkbox";
        block.checked = Boolean(limit.block);
        block.addEventListener("change", () => {
            persist({
                limits: { ...settings.limits, [domain]: { ...limit, block: block.checked } },
            });
        });
        blockCell.appendChild(block);

        const removeCell = row.insertCell();
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "button tiny ghost";
        remove.textContent = "Entfernen";
        remove.addEventListener("click", () => {
            const limits = { ...settings.limits };
            delete limits[domain];
            persist({ limits }).then(renderLimits);
        });
        removeCell.appendChild(remove);
    }
}

el("addLimit").addEventListener("click", () => {
    const domain = el("newLimitDomain").value.trim().toLowerCase().replace(/^www\./, "");
    const minutes = Number(el("newLimitMinutes").value);
    if (!domain || !minutes || minutes < 1) {
        status("dataStatus", "Domain und Minuten angeben.", true);
        return;
    }
    persist({
        limits: {
            ...settings.limits,
            [domain]: { minutes: Math.round(minutes), block: el("newLimitBlock").checked },
        },
    }).then(() => {
        el("newLimitDomain").value = "";
        el("newLimitMinutes").value = "";
        el("newLimitBlock").checked = false;
        renderLimits();
    });
});

/* ------------------------------------------------------------- Kategorien */

async function renderCategories() {
    const box = el("categoryRows");
    box.textContent = "";

    const usage = await getUsage();
    const byUsage = aggregate(usage).slice(0, CATEGORY_ROW_LIMIT).map(([domain]) => domain);
    // Zugeordnete Domains immer zeigen, auch wenn sie zuletzt ungenutzt waren.
    const domains = Array.from(new Set([...Object.keys(settings.categoryOverrides), ...byUsage]));

    if (!domains.length) {
        box.innerHTML = '<p class="muted">Sobald Daten da sind, erscheinen die Domains hier.</p>';
        return;
    }

    const totals = new Map(aggregate(usage));

    for (const domain of domains) {
        const row = document.createElement("div");
        row.className = "category-row";

        const name = document.createElement("span");
        name.className = "category-domain";
        name.textContent = domain;

        const time = document.createElement("span");
        time.className = "muted";
        time.textContent = totals.has(domain) ? formatDuration(totals.get(domain)) : "";

        const select = buildCategorySelect(categoryOf(domain, settings.categoryOverrides));
        select.addEventListener("change", () => {
            const overrides = { ...settings.categoryOverrides };
            if (select.value === "auto") delete overrides[domain];
            else overrides[domain] = select.value;
            persist({ categoryOverrides: overrides });
        });
        if (!settings.categoryOverrides[domain]) select.value = "auto";

        row.append(name, time, select);
        box.appendChild(row);
    }
}

function buildCategorySelect(selected) {
    const select = document.createElement("select");
    const auto = document.createElement("option");
    auto.value = "auto";
    auto.textContent = "automatisch";
    select.appendChild(auto);

    for (const key of CATEGORY_KEYS) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = CATEGORIES[key].label;
        select.appendChild(option);
    }
    select.value = selected;
    return select;
}

el("addCategory").addEventListener("click", () => {
    const domain = el("newCategoryDomain").value.trim().toLowerCase().replace(/^www\./, "");
    const value = el("newCategoryValue").value;
    if (!domain || !CATEGORIES[value]) return;
    persist({ categoryOverrides: { ...settings.categoryOverrides, [domain]: value } }).then(() => {
        el("newCategoryDomain").value = "";
        renderCategories();
    });
});

/* ---------------------------------------------------------------- Report */

async function renderReport() {
    const box = el("reportBox");
    box.textContent = "";

    const reports = await getReports();
    if (!reports.length) {
        box.innerHTML = '<p class="muted">Der erste Report entsteht am kommenden Montag.</p>';
        return;
    }

    const report = reports[0];
    const heading = document.createElement("h3");
    heading.textContent = `Woche ${report.week}`;

    const summary = document.createElement("p");
    summary.textContent = reportSummary(report);

    const list = document.createElement("ol");
    list.className = "report-top";
    for (const [domain, ms] of report.top.slice(0, 5)) {
        const li = document.createElement("li");
        li.textContent = `${domain} – ${formatMinutes(ms)}`;
        list.appendChild(li);
    }

    const days = document.createElement("p");
    days.className = "muted";
    days.textContent = `An ${report.activeDays} von 7 Tagen aktiv.`;

    box.append(heading, summary, list, days);
}

/* ------------------------------------------------------------------ Daten */

el("exportCsv").addEventListener("click", async () => {
    const usage = await getUsage();
    download(`websitetimetrack-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(usage), "text/csv");
    status("dataStatus", "CSV erstellt.");
});

el("exportJson").addEventListener("click", async () => {
    download(
        `websitetimetrack-backup-${new Date().toISOString().slice(0, 10)}.json`,
        await toJSON(),
        "application/json",
    );
    status("dataStatus", "Backup erstellt.");
});

el("importJson").addEventListener("click", () => el("importFile").click());

el("importFile").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
        const mode = el("importReplace").checked ? "replace" : "merge";
        const { days } = await importJSON(await file.text(), mode);
        status("dataStatus", `${days} Tage eingelesen.`);
        settings = await getSettings();
        renderReport();
        renderCategories();
    } catch (error) {
        status("dataStatus", error.message, true);
    } finally {
        event.target.value = "";
    }
});

el("pushSync").addEventListener("click", async () => {
    if (!settings.syncUsage) {
        status("syncStatus", "Abgleich ist ausgeschaltet.", true);
        return;
    }
    try {
        await sync.push(settings.syncDays);
        status("syncStatus", "Abgeglichen.");
    } catch (error) {
        status("syncStatus", `Fehlgeschlagen: ${error.message}`, true);
    }
});

/* ------------------------------------------------------------------ Binding */

/** Verbindet ein Eingabefeld mit einem Einstellungsfeld. */
function bind(id, key, { type = "value", parse = (v) => v, after } = {}) {
    const node = el(id);
    node.addEventListener("change", async () => {
        await persist({ [key]: parse(type === "checked" ? node.checked : node.value) });
        if (after) after();
    });
}

function fillForm() {
    el("idleSeconds").value = settings.idleSeconds;
    el("requireInteraction").checked = settings.requireInteraction;
    el("interactionTimeoutSeconds").value = settings.interactionTimeoutSeconds;
    el("audibleCountsAsActive").checked = settings.audibleCountsAsActive;
    el("trackSubEntities").checked = settings.trackSubEntities;
    el("genericSubEntityDomains").value = settings.genericSubEntityDomains.join("\n");
    el("ignore").value = settings.ignore.join("\n");
    el("notifyAtPercent").value = settings.notifyAtPercent;
    el("focusActive").checked = Boolean(settings.focus.active);
    el("focusUntil").value = toLocalInput(settings.focus.until);
    el("focusSites").value = (settings.focus.sites || []).join("\n");
    el("weeklyReport").checked = settings.weeklyReport;
    el("syncUsage").checked = settings.syncUsage;
    el("syncDays").value = settings.syncDays;
}

async function init() {
    settings = await getSettings();
    fillForm();

    el("newCategoryValue").replaceWith(
        Object.assign(buildCategorySelect("work"), { id: "newCategoryValue" }),
    );
    // "automatisch" ergibt beim Neuanlegen keinen Sinn.
    el("newCategoryValue").querySelector('option[value="auto"]').remove();

    bind("idleSeconds", "idleSeconds", { parse: (v) => Math.max(15, Number(v) || 60) });
    bind("requireInteraction", "requireInteraction", { type: "checked" });
    bind("interactionTimeoutSeconds", "interactionTimeoutSeconds", {
        parse: (v) => Math.max(15, Number(v) || 90),
    });
    bind("audibleCountsAsActive", "audibleCountsAsActive", { type: "checked" });
    bind("trackSubEntities", "trackSubEntities", { type: "checked" });
    bind("genericSubEntityDomains", "genericSubEntityDomains", { parse: linesToList });
    bind("ignore", "ignore", { parse: linesToList });
    bind("notifyAtPercent", "notifyAtPercent", {
        parse: (v) => Math.min(99, Math.max(1, Number(v) || 80)),
    });
    bind("weeklyReport", "weeklyReport", { type: "checked" });
    bind("syncDays", "syncDays", { parse: (v) => Math.min(30, Math.max(1, Number(v) || 14)) });

    el("syncUsage").addEventListener("change", async () => {
        const enabled = el("syncUsage").checked;
        await persist({ syncUsage: enabled });
        try {
            if (enabled) await sync.push(settings.syncDays);
            else await sync.clearOwn(); // Beim Abschalten den Sync-Speicher freigeben.
            status("syncStatus", enabled ? "Abgleich aktiv." : "Abgleich aus, Daten entfernt.");
        } catch (error) {
            status("syncStatus", `Fehlgeschlagen: ${error.message}`, true);
        }
    });

    for (const id of ["focusActive", "focusUntil", "focusSites"]) {
        el(id).addEventListener("change", () => {
            const until = el("focusUntil").value ? new Date(el("focusUntil").value).getTime() : 0;
            persist({
                focus: {
                    active: el("focusActive").checked,
                    until,
                    sites: linesToList(el("focusSites").value),
                },
            });
        });
    }

    renderLimits();
    renderCategories();
    renderReport();
}

init();
