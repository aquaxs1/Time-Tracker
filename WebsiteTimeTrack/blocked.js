/** Sperrseite: erklaert, warum hier Schluss ist, und bietet eine Ausnahme an. */

import { dayKey, formatMinutes } from "./lib/time.js";
import { getSettings, focusActive } from "./lib/settings.js";
import { limitFor } from "./lib/limits.js";
import { getUsage } from "./lib/storage.js";

const params = new URLSearchParams(location.search);
const domain = params.get("d") || "";
const original = params.get("u") || "";
const reason = params.get("r") || "limit";

document.getElementById("headline").textContent =
    reason === "focus" ? "Fokusmodus laeuft" : "Tageslimit erreicht";

async function render() {
    const settings = await getSettings();
    const usage = await getUsage();
    const todayMs = (usage[dayKey(Date.now())] || {})[domain] || 0;

    const reasonEl = document.getElementById("reason");
    const detailEl = document.getElementById("detail");
    const noteEl = document.getElementById("note");

    reasonEl.textContent =
        reason === "focus"
            ? `${domain} ist waehrend des Fokusmodus gesperrt.`
            : `${domain} ist fuer heute aufgebraucht.`;

    const limit = limitFor(domain, settings);
    if (limit) {
        detailEl.textContent = `Heute ${formatMinutes(todayMs)} von ${limit.minutes} min.`;
    } else if (todayMs > 0) {
        detailEl.textContent = `Heute bereits ${formatMinutes(todayMs)} auf dieser Seite.`;
    }

    if (reason === "focus" && focusActive(settings) && settings.focus.until) {
        const until = new Date(settings.focus.until);
        noteEl.textContent = `Fokusmodus laeuft bis ${until.toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
        })}.`;
    }
}

document.getElementById("snooze").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "snooze", domain });
    if (!response || !response.ok) return;
    // Zurueck auf die urspruengliche Seite, sonst landet man auf einer leeren Domain.
    location.replace(original || `https://${domain}`);
});

document.getElementById("options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

render();
