/** Block page: explains why access stops here and offers an exception. */

import { dayKey, formatMinutes } from "./lib/time.js";
import { getSettings, focusActive } from "./lib/settings.js";
import { limitFor } from "./lib/limits.js";
import { getUsage } from "./lib/storage.js";
import { applyTheme } from "./lib/theme.js";

const params = new URLSearchParams(location.search);
const domain = params.get("d") || "";
const original = params.get("u") || "";
const reason = params.get("r") || "limit";

document.getElementById("headline").textContent =
    reason === "focus" ? "Focus mode is on" : "Daily limit reached";

async function render() {
    const settings = await getSettings();
    applyTheme(settings.theme);
    const usage = await getUsage();
    const todayMs = (usage[dayKey(Date.now())] || {})[domain] || 0;

    const reasonEl = document.getElementById("reason");
    const detailEl = document.getElementById("detail");
    const noteEl = document.getElementById("note");

    reasonEl.textContent =
        reason === "focus"
            ? `${domain} is blocked while focus mode is active.`
            : `${domain} is used up for today.`;

    const limit = limitFor(domain, settings);
    if (limit) {
        detailEl.textContent = `${formatMinutes(todayMs)} of ${limit.minutes} min used today.`;
    } else if (todayMs > 0) {
        detailEl.textContent = `Already ${formatMinutes(todayMs)} on this site today.`;
    }

    if (reason === "focus" && focusActive(settings) && settings.focus.until) {
        const until = new Date(settings.focus.until);
        noteEl.textContent = `Focus mode runs until ${until.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
        })}.`;
    }
}

document.getElementById("snooze").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "snooze", domain });
    if (!response || !response.ok) return;
    // Back to the original page, or you'd land on a blank domain.
    location.replace(original || `https://${domain}`);
});

document.getElementById("options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

render();
