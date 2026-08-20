/** Export und Import der Nutzungsdaten. */

import { getUsage, getDetail, serialize } from "./storage.js";
import { getSettings, saveSettings } from "./settings.js";

/** CSV-Feld: Trennzeichen, Anfuehrungszeichen und Umbrueche maskieren. */
function csvField(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Eine Zeile je Tag und Domain – so laesst sich die Datei direkt in einer
 * Tabellenkalkulation als Pivot auswerten.
 */
export function toCSV(usage) {
    const rows = [["Datum", "Domain", "Sekunden", "Minuten", "Stunden"]];

    for (const day of Object.keys(usage).sort()) {
        const bucket = usage[day] || {};
        for (const [domain, ms] of Object.entries(bucket).sort((a, b) => b[1] - a[1])) {
            if (typeof ms !== "number" || ms <= 0) continue;
            rows.push([
                day,
                domain,
                Math.round(ms / 1000),
                (ms / 60000).toFixed(2),
                (ms / 3600000).toFixed(3),
            ]);
        }
    }
    // BOM voran, sonst zerlegt Excel Umlaute in Domainnamen.
    return "﻿" + rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}

/** Vollstaendiges Backup inklusive Unterobjekten und Einstellungen. */
export async function toJSON() {
    return JSON.stringify(
        {
            format: "WebsiteTimeTrack",
            version: 3,
            exportedAt: new Date().toISOString(),
            usage: await getUsage(),
            detail: await getDetail(),
            settings: await getSettings(),
        },
        null,
        2,
    );
}

/**
 * Backup einlesen. `mode` entscheidet, was mit vorhandenen Daten passiert:
 * "merge" addiert, "replace" ersetzt sie.
 */
export async function importJSON(text, mode = "merge") {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("Datei ist kein gueltiges JSON.");
    }
    if (!data || data.format !== "WebsiteTimeTrack" || typeof data.usage !== "object") {
        throw new Error("Das ist kein WebsiteTimeTrack-Backup.");
    }

    await serialize(async () => {
        const current = mode === "replace" ? {} : await getUsage();
        const currentDetail = mode === "replace" ? {} : await getDetail();

        for (const [day, bucket] of Object.entries(data.usage || {})) {
            if (!bucket || typeof bucket !== "object") continue;
            const target = current[day] || (current[day] = {});
            for (const [domain, ms] of Object.entries(bucket)) {
                if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) continue;
                target[domain] = (target[domain] || 0) + ms;
            }
        }

        for (const [day, byDomain] of Object.entries(data.detail || {})) {
            if (!byDomain || typeof byDomain !== "object") continue;
            const targetDay = currentDetail[day] || (currentDetail[day] = {});
            for (const [domain, labels] of Object.entries(byDomain)) {
                if (!labels || typeof labels !== "object") continue;
                const target = targetDay[domain] || (targetDay[domain] = {});
                for (const [label, ms] of Object.entries(labels)) {
                    if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) continue;
                    target[label] = (target[label] || 0) + ms;
                }
            }
        }

        await chrome.storage.local.set({ usage: current, detail: currentDetail });
    });

    if (data.settings && mode === "replace") await saveSettings(data.settings);

    const days = Object.keys(data.usage || {}).length;
    return { days };
}

/** Loest den Download aus. Nur von Extension-Seiten aus aufrufen. */
export function download(filename, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Erst nach dem Klick freigeben, sonst bricht der Download ab.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
