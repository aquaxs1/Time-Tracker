/**
 * Content-Script.
 *
 * Zwei Aufgaben:
 *   1. Echte Interaktion melden (Maus, Tastatur, Scrollen) – damit ein nur
 *      geoeffneter Tab nicht als Nutzung durchgeht.
 *   2. Auf YouTube-Videoseiten den Kanalnamen nachliefern; in der URL steht er
 *      nicht drin.
 *
 * Bewusst schlank: gedrosselte Meldungen, passive Listener, kein Framework.
 */

(() => {
    const INTERACTION_THROTTLE_MS = 5000;
    const EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "wheel", "touchstart"];

    let lastSent = 0;

    /** Der Service Worker kann gerade schlafen – Fehler sind hier normal. */
    function send(message) {
        try {
            chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
        } catch {
            // Extension wurde neu geladen oder entladen.
        }
    }

    function onInteraction() {
        const now = Date.now();
        if (now - lastSent < INTERACTION_THROTTLE_MS) return;
        lastSent = now;
        send({ type: "interaction" });
    }

    for (const event of EVENTS) {
        addEventListener(event, onInteraction, { passive: true, capture: true });
    }

    // Sichtbar werden ist auch eine Form von Zuwendung.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") onInteraction();
    });

    /* ------------------------------------------------------------- YouTube */

    if (location.hostname.endsWith("youtube.com")) {
        const SELECTORS = [
            "ytd-video-owner-renderer ytd-channel-name a",
            "#upload-info ytd-channel-name a",
            'span[itemprop="author"] link[itemprop="name"]',
            'meta[itemprop="channelName"]',
        ];

        function readChannel() {
            for (const selector of SELECTORS) {
                const node = document.querySelector(selector);
                if (!node) continue;
                const value = node.getAttribute("content") || node.textContent || "";
                const label = value.trim();
                if (label) return label;
            }
            return null;
        }

        let reported = null;
        let attempts = 0;
        let timer = null;

        function poll() {
            // YouTube rendert den Kanalnamen nach; ein paar Versuche reichen.
            const label = readChannel();
            if (label && label !== reported) {
                reported = label;
                send({ type: "entity", label });
                return;
            }
            if (++attempts < 20) timer = setTimeout(poll, 500);
        }

        function restart() {
            clearTimeout(timer);
            reported = null;
            attempts = 0;
            if (location.pathname === "/watch") poll();
        }

        restart();
        // YouTube ist eine Single-Page-App: kein Reload beim Videowechsel.
        addEventListener("yt-navigate-finish", restart);

        let lastUrl = location.href;
        setInterval(() => {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            restart();
        }, 1000);
    }
})();
