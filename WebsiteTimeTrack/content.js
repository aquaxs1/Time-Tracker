/**
 * Content script.
 *
 * Two jobs:
 *   1. Report real interaction (mouse, keyboard, scroll) – so a merely open
 *      tab doesn't count as usage.
 *   2. On YouTube video pages, supply the channel name; it isn't in the URL.
 *
 * Deliberately lean: throttled messages, passive listeners, no framework.
 */

(() => {
    const INTERACTION_THROTTLE_MS = 5000;
    const EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "wheel", "touchstart"];

    let lastSent = 0;

    /** The service worker may be asleep right now – errors here are normal. */
    function send(message) {
        try {
            chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
        } catch {
            // The extension was reloaded or unloaded.
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

    // Becoming visible counts as attention too.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") onInteraction();
    });

    /* --------------------------------------------------------------- YouTube */

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
            // YouTube renders the channel name in after load; a few retries suffice.
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
        // YouTube is a single-page app: no reload when switching videos.
        addEventListener("yt-navigate-finish", restart);

        let lastUrl = location.href;
        setInterval(() => {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            restart();
        }, 1000);
    }
})();
