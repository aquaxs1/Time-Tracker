/**
 * Weekly report.
 *
 * Runs once on Monday and summarizes the past week: total time, top sites,
 * categories, productivity score, and the comparison to the week before. The
 * report gets saved; the notification is just a pointer to it.
 */

import { DAY_MS, dayKey, formatMinutes, weekKey } from "./time.js";
import { aggregate, getReports, getUsage, saveReport } from "./storage.js";
import { productivityScore, scoreLabel, totalsByCategory } from "./categories.js";
import { notify } from "./limits.js";

/** The seven day keys of the week `timestamp` falls in (Mon–Sun). */
export function weekDays(timestamp) {
    const d = new Date(timestamp);
    d.setHours(12, 0, 0, 0);
    const offsetToMonday = (d.getDay() + 6) % 7;
    const monday = d.getTime() - offsetToMonday * DAY_MS;
    return Array.from({ length: 7 }, (_, i) => dayKey(monday + i * DAY_MS));
}

/** Builds the report for the week `timestamp` falls in. */
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

/** Short text for the notification. */
export function reportSummary(report) {
    const parts = [`${formatMinutes(report.totalMs)} online`];

    if (report.previousMs > 0) {
        const diff = report.totalMs - report.previousMs;
        const percent = Math.round((diff / report.previousMs) * 100);
        if (Math.abs(percent) >= 1) {
            parts.push(`${percent > 0 ? "+" : ""}${percent}% vs. last week`);
        }
    }
    if (report.score !== null) parts.push(`Score ${report.score} (${scoreLabel(report.score)})`);
    if (report.top.length) parts.push(`Top: ${report.top[0][0]}`);

    return parts.join(" · ");
}

/**
 * Creates the previous week's report once a new week has started.
 * Called hourly and does nothing outside of that moment.
 */
export async function maybeCreateWeeklyReport(settings, now = Date.now()) {
    if (!settings.weeklyReport) return null;

    const lastWeekTimestamp = now - 7 * DAY_MS;
    const week = weekKey(lastWeekTimestamp);

    const reports = await getReports();
    if (reports.some((report) => report.week === week)) return null;

    const usage = await getUsage();
    const report = buildReport(usage, settings, lastWeekTimestamp);
    if (report.totalMs <= 0) return null; // An empty week isn't worth a notification.

    await saveReport(report);
    await notify(`report-${week}`, `Weekly report – week ${week}`, reportSummary(report));
    return report;
}
