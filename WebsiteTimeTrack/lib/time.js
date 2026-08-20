/** Zeit- und Datumshelfer. Alles bewusst in lokaler Zeit, nicht UTC. */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Tagesschluessel im Format YYYY-MM-DD. */
export function dayKey(timestamp) {
    const d = new Date(timestamp);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
}

/** Millisekunden zum Beginn des Tages, zu dem `dayKey` gehoert. */
export function dayStart(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
}

/** Die letzten `count` Tagesschluessel, neuester zuerst. */
export function lastDays(count, from = Date.now()) {
    const days = [];
    const anchor = new Date(from);
    anchor.setHours(12, 0, 0, 0); // Mittags rechnen, dann stoert keine Zeitumstellung.
    for (let i = 0; i < count; i++) {
        days.push(dayKey(anchor.getTime() - i * DAY_MS));
    }
    return days;
}

/** ISO-Wochenschluessel, z.B. 2026-W34. */
export function weekKey(timestamp) {
    const d = new Date(timestamp);
    d.setHours(12, 0, 0, 0);
    // Auf den Donnerstag der Woche schieben – so definiert ISO 8601 das Jahr.
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const firstThursday = new Date(d.getFullYear(), 0, 4);
    firstThursday.setHours(12, 0, 0, 0);
    firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
    const week = 1 + Math.round((d - firstThursday) / (7 * DAY_MS));
    return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Zerlegt ein Segment an Mitternacht, damit jeder Tag korrekt gebucht wird. */
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

/** Kompakte Dauer: groessere Einheiten nur, wenn vorhanden. */
export function formatDuration(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h} h ${m} min`;
    if (m > 0) return `${m} min ${s} s`;
    return `${s} s`;
}

/** Dauer ohne Sekunden – fuer Limits und Reports. */
export function formatMinutes(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Kurzes Tagesetikett fuer Diagramme, z.B. "Mo 18.8." */
export function shortDayLabel(key) {
    const d = new Date(dayStart(key));
    const weekday = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()];
    return `${weekday} ${d.getDate()}.${d.getMonth() + 1}.`;
}
