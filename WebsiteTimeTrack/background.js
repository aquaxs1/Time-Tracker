let activeTabId = null;
let lastActiveTime = Date.now();

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    activeTabId = activeInfo.tabId;
    lastActiveTime = Date.now();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === activeTabId && changeInfo.status === 'complete') {
        lastActiveTime = Date.now();
    }
});

chrome.idle.onStateChanged.addListener((state) => {
    if (state === "idle" || state === "locked") {
        activeTabId = null; // Stop counting
    } else {
        lastActiveTime = Date.now();
    }
});

// Jede Sekunde die Zeit aktualisieren
setInterval(async () => {
    if (activeTabId === null) return;

    const tab = await chrome.tabs.get(activeTabId);
    if (!tab || !tab.url.startsWith("http")) return;

    const domain = new URL(tab.url).hostname;
    const now = Date.now();
    const delta = Math.floor((now - lastActiveTime) / 1000); // in Sekunden
    lastActiveTime = now;

    chrome.storage.local.get([domain], (result) => {
        const prevTime = result[domain] || 0;
        chrome.storage.local.set({ [domain]: prevTime + delta });
    });
}, 1000);
