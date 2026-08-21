/**
 * Applies the "auto" / "light" / "dark" theme setting to the current page.
 *
 * The CSS itself decides the colours (see styles.css); this only toggles the
 * `data-theme` attribute that the CSS keys off. A copy is kept in
 * localStorage so the next page load can set the attribute before first
 * paint, without waiting on the async chrome.storage read – see the inline
 * script at the top of each HTML file's <head>.
 */

const STORAGE_KEY = "theme";

export function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === "light" || theme === "dark") {
        root.dataset.theme = theme;
    } else {
        delete root.dataset.theme; // "auto" – follow the OS setting.
    }
    try {
        localStorage.setItem(STORAGE_KEY, theme || "auto");
    } catch {
        // Private browsing can block localStorage; the attribute above still works.
    }
}
