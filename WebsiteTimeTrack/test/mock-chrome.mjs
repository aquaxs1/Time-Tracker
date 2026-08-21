/**
 * A minimal stand-in for the Chrome extension APIs, for tests.
 * Covers only what the extension actually calls.
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
        updated: [], // { tabId, url } – forced redirects land here
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
            // Deep-clone so tests never accidentally share references.
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

/** Installs the mock globally and returns it. */
export function install(world) {
    const chrome = makeChrome(world);
    globalThis.chrome = chrome;
    return chrome;
}

/**
 * Fires an event and then lets the internal write chain drain.
 * Chrome listeners don't return a promise, so a bare `await` wouldn't wait.
 */
export async function fire(chrome, name, ...args) {
    for (const listener of chrome._listeners[name] || []) listener(...args);
    await settleQueue();
}

/** Waits until every triggered promise has run its course. */
export async function settleQueue(rounds = 12) {
    for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

/** Calls a message handler and returns its reply. */
export function sendMessage(chrome, message, sender = {}) {
    return new Promise((resolve) => {
        for (const listener of chrome._listeners.message || []) {
            const async_ = listener(message, sender, resolve);
            if (async_ === true) return;
        }
        resolve(undefined);
    });
}

/** Total for a domain across all days. */
export function totalFor(local, domain) {
    return Object.values(local.usage || {}).reduce(
        (sum, bucket) => sum + (bucket[domain] || 0),
        0,
    );
}
