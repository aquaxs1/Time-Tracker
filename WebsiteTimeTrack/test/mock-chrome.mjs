/**
 * Minimaler Nachbau der Chrome-Extension-APIs fuer die Tests.
 * Bildet nur ab, was die Extension tatsaechlich aufruft.
 */

export function makeWorld(overrides = {}) {
    return {
        local: {},
        session: {},
        sync: {},
        idleState: "active",
        focusedWindowId: 1,
        windowFocused: true,
        tabs: [{ id: 1, url: "https://example.com/", active: true, windowId: 1, audible: false }],
        notifications: [],
        updated: [], // { tabId, url } – hier landen erzwungene Umleitungen
        openedOptions: 0,
        ...overrides,
    };
}

function storageArea(getStore) {
    return {
        async get(keys) {
            const store = getStore();
            if (keys === null || keys === undefined) return { ...store };
            if (typeof keys === "string") return keys in store ? { [keys]: store[keys] } : {};
            const out = {};
            for (const key of keys) if (key in store) out[key] = store[key];
            return out;
        },
        async set(obj) {
            // Struktur klonen, damit Tests nicht versehentlich Referenzen teilen.
            Object.assign(getStore(), JSON.parse(JSON.stringify(obj)));
        },
        async remove(keys) {
            const store = getStore();
            for (const key of [].concat(keys)) delete store[key];
        },
    };
}

export function makeChrome(world) {
    const listeners = {};
    const event = (name) => ({
        addListener: (fn) => {
            (listeners[name] || (listeners[name] = [])).push(fn);
        },
    });

    const chrome = {
        _world: world,
        _listeners: listeners,

        storage: {
            local: storageArea(() => world.local),
            session: storageArea(() => world.session),
            sync: storageArea(() => world.sync),
            onChanged: event("storageChanged"),
        },

        tabs: {
            onActivated: event("tabActivated"),
            onRemoved: event("tabRemoved"),
            onUpdated: event("tabUpdated"),
            async query(filter = {}) {
                let result = world.tabs.slice();
                if (filter.active) result = result.filter((tab) => tab.active);
                if (filter.windowId !== undefined) {
                    result = result.filter((tab) => tab.windowId === filter.windowId);
                }
                if (filter.url) {
                    result = result.filter((tab) => /^https?:/.test(tab.url || ""));
                }
                return result;
            },
            async update(tabId, props) {
                world.updated.push({ tabId, url: props.url });
                const tab = world.tabs.find((t) => t.id === tabId);
                if (tab) tab.url = props.url;
            },
        },

        windows: {
            onFocusChanged: event("focus"),
            async getLastFocused() {
                return { id: world.focusedWindowId, focused: world.windowFocused };
            },
        },

        idle: {
            onStateChanged: event("idle"),
            async queryState() {
                return world.idleState;
            },
            setDetectionInterval() {},
        },

        alarms: {
            onAlarm: event("alarm"),
            async create() {},
        },

        notifications: {
            onClicked: event("notificationClicked"),
            async create(id, options) {
                world.notifications.push({ id, ...options });
            },
        },

        runtime: {
            lastError: null,
            onMessage: event("message"),
            onInstalled: event("installed"),
            onStartup: event("startup"),
            getURL: (path) => `chrome-extension://test/${path.replace(/^\//, "")}`,
            openOptionsPage() {
                world.openedOptions += 1;
            },
            sendMessage(_message, callback) {
                if (callback) callback({ ok: true });
            },
        },
    };

    return chrome;
}

/** Installiert den Mock global und gibt ihn zurueck. */
export function install(world) {
    const chrome = makeChrome(world);
    globalThis.chrome = chrome;
    return chrome;
}

/**
 * Feuert ein Ereignis und laesst danach die interne Schreibkette auslaufen.
 * Chrome-Listener geben kein Promise zurueck, `await` allein wuerde nicht warten.
 */
export async function fire(chrome, name, ...args) {
    for (const listener of chrome._listeners[name] || []) listener(...args);
    await settleQueue();
}

/** Wartet, bis alle angestossenen Promises durchgelaufen sind. */
export async function settleQueue(rounds = 12) {
    for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

/** Ruft einen Message-Handler auf und liefert dessen Antwort. */
export function sendMessage(chrome, message, sender = {}) {
    return new Promise((resolve) => {
        for (const listener of chrome._listeners.message || []) {
            const async_ = listener(message, sender, resolve);
            if (async_ === true) return;
        }
        resolve(undefined);
    });
}

/** Summe einer Domain ueber alle Tage. */
export function totalFor(local, domain) {
    return Object.values(local.usage || {}).reduce(
        (sum, bucket) => sum + (bucket[domain] || 0),
        0,
    );
}
