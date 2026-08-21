/** Time and date helpers. Deliberately all in local time, never UTC. */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Day key in YYYY-MM-DD format. */
export function dayKey(timestamp) {
    const d = new Date(timestamp);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
}

/** Milliseconds at the start of the day a `dayKey` refers to. */
export function dayStart(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
}

/** The last `count` day keys, most recent first. */
export function lastDays(count, from = Date.now()) {
    const days = [];
    const anchor = new Date(from);
    anchor.setHours(12, 0, 0, 0); // Anchor at noon so DST changes can't shift a day.
    for (let i = 0; i < count; i++) {
        days.push(dayKey(anchor.getTime() - i * DAY_MS));
    }
    return days;
}

/** ISO week key, e.g. 2026-W34. */
export function weekKey(timestamp) {
    const d = new Date(timestamp);
    d.setHours(12, 0, 0, 0);
    // Shift to the week's Thursday – that's how ISO 8601 defines the year.
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const firstThursday = new Date(d.getFullYear(), 0, 4);
    firstThursday.setHours(12, 0, 0, 0);
    firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
    const week = 1 + Math.round((d - firstThursday) / (7 * DAY_MS));
    return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Splits a segment at midnight so every day is booked correctly. */
export function splitByDay(start, end) {
    const parts = [];
    let cursor = start;
    while (cursor < end) {
        const d = new Date(cursor);
        const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
        const chunkEnd = Math.min(end, nextMidnight);
        parts.push([dayKey(cursor), chunkEnd - cursor]);
        cursor = chunkEnd;
    }
    return parts;
}

/** Compact duration: larger units only when present. */
export function formatDuration(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h} h ${m} min`;
    if (m > 0) return `${m} min ${s} s`;
    return `${s} s`;
}

/** Duration without seconds – for limits and reports. */
export function formatMinutes(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Short day label for charts, e.g. "Mon 8/18". */
export function shortDayLabel(key) {
    const d = new Date(dayStart(key));
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
    return `${weekday} ${d.getMonth() + 1}/${d.getDate()}`;
}
