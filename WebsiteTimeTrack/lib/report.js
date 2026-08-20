/**
 * Wochenreport.
 *
 * Laeuft montags einmal und fasst die vergangene Woche zusammen: Gesamtzeit,
 * Top-Seiten, Kategorien, Produktivitaets-Score und der Vergleich zur Woche
 * davor. Der Report wird gespeichert, die Benachrichtigung ist nur der Hinweis
 * darauf.
 */

import { DAY_MS, dayKey, formatMinutes, weekKey } from "./time.js";
import { aggregate, getReports, getUsage, saveReport } from "./storage.js";
import { productivityScore, scoreLabel, totalsByCategory } from "./categories.js";
import { notify } from "./limits.js";

/** Die sieben Tagesschluessel der Woche, in der `timestamp` liegt (Mo–So). */
export function weekDays(timestamp) {
    const d = new Date(timestamp);
    d.setHours(12, 0, 0, 0);
    const offsetToMonday = (d.getDay() + 6) % 7;
    const monday = d.getTime() - offsetToMonday * DAY_MS;
    return Array.from({ length: 7 }, (_, i) => dayKey(monday + i * DAY_MS));
}

/** Baut den Report fuer die Woche, in der `timestamp` liegt. */
export function buildReport(usage, settings, timestamp) {
    const days = weekDays(timestamp);
    const entries = aggregate(usage, days);
    const totalMs = entries.reduce((sum, [, ms]) => sum + ms, 0);

    const categories = totalsByCategory(entries, settings.categoryOverrides);
    const score = productivityScore(categories);

    const previous = aggregate(usage, weekDays(timestamp - 7 * DAY_MS));
    const previousMs = previous.reduce((sum, [, ms]) => sum + ms, 0);

    const perDay = {};
    for (const day of days) {
        const bucket = usage[day] || {};
        perDay[day] = Object.values(bucket).reduce(
            (sum, ms) => sum + (typeof ms === "number" && ms > 0 ? ms : 0),
            0,
        );
    }

    return {
        week: weekKey(timestamp),
        generatedAt: Date.now(),
        days,
        totalMs,
        previousMs,
        perDay,
        top: entries.slice(0, 10),
        categories,
        score,
        activeDays: Object.values(perDay).filter((ms) => ms > 0).length,
    };
}

/** Kurztext fuer die Benachrichtigung. */
export function reportSummary(report) {
    const parts = [`${formatMinutes(report.totalMs)} online`];

    if (report.previousMs > 0) {
        const diff = report.totalMs - report.previousMs;
        const percent = Math.round((diff / report.previousMs) * 100);
        if (Math.abs(percent) >= 1) {
            parts.push(`${percent > 0 ? "+" : ""}${percent} % zur Vorwoche`);
        }
    }
    if (report.score !== null) parts.push(`Score ${report.score} (${scoreLabel(report.score)})`);
    if (report.top.length) parts.push(`Top: ${report.top[0][0]}`);

    return parts.join(" · ");
}

/**
 * Erzeugt den Report der Vorwoche, sobald eine neue Woche begonnen hat.
 * Wird stuendlich aufgerufen und tut ausserhalb dieses Falls nichts.
 */
export async function maybeCreateWeeklyReport(settings, now = Date.now()) {
    if (!settings.weeklyReport) return null;

    const lastWeekTimestamp = now - 7 * DAY_MS;
    const week = weekKey(lastWeekTimestamp);

    const reports = await getReports();
    if (reports.some((report) => report.week === week)) return null;

    const usage = await getUsage();
    const report = buildReport(usage, settings, lastWeekTimestamp);
    if (report.totalMs <= 0) return null; // Leere Wochen sind keine Meldung wert.

    await saveReport(report);
    await notify(`report-${week}`, `Wochenreport ${week}`, reportSummary(report));
    return report;
}
