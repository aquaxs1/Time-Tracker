import fs from "node:fs";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "background.js");

// ---- Fake chrome -----------------------------------------------------------
function makeChrome(world) {
  const listeners = {};
  const ev = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const area = (store) => ({
    get: async (keys) => {
      if (keys === null || keys === undefined) return { ...store };
      if (typeof keys === "string") return keys in store ? { [keys]: store[keys] } : {};
      const out = {};
      for (const k of keys) if (k in store) out[k] = store[k];
      return out;
    },
    set: async (obj) => Object.assign(store, obj),
    remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
  });
  return {
    _listeners: listeners,
    storage: { local: area(world.local), session: area(world.session) },
    tabs: { onActivated: ev("tabActivated"), onRemoved: ev("tabRemoved"), onUpdated: ev("tabUpdated"),
            query: async () => (world.tab ? [world.tab] : []) },
    windows: { onFocusChanged: ev("focus"), getLastFocused: async () => world.window },
    idle: { onStateChanged: ev("idle"), queryState: async () => world.idleState,
            setDetectionInterval: () => {} },
    alarms: { onAlarm: ev("alarm"), create: async () => {} },
    runtime: { onMessage: ev("message"), onInstalled: ev("installed"), onStartup: ev("startup") },
  };
}

let loadCounter = 0;
async function load(world) {
  globalThis.chrome = makeChrome(world);
  // Marker pro Load, sonst liefert der ES-Modul-Cache dieselbe Instanz zurueck
  // und der Modulrumpf laeuft kein zweites Mal (= keine Listener).
  const src = fs.readFileSync(SRC, "utf8") + `\n// load ${loadCounter++}\n`;
  await import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
  await new Promise((r) => setTimeout(r, 10)); // top-level sync() abwarten
  return globalThis.chrome;
}

// Chrome-Listener geben kein Promise zurueck – nach dem Feuern die interne
// Write-Chain auslaufen lassen, bevor der Test den Storage prueft.
async function fire(c, name, ...args) {
  const out = c._listeners[name](...args);
  await new Promise((r) => setTimeout(r, 20));
  return out;
}

const active = (url) => ({
  local: {}, session: {}, idleState: "active",
  window: { id: 1, focused: true }, tab: { id: 5, url, active: true },
});

let now = new Date("2026-08-20T10:00:00").getTime();
Date.now = () => now;
const tick = (ms) => (now += ms);
const totalFor = (local, domain) =>
  Object.values(local.usage || {}).reduce((s, b) => s + (b[domain] || 0), 0);

// ---- 1. Grundfall: SW-Neustart erfasst den aktiven Tab sofort ---------------
{
  const world = active("https://www.youtube.com/watch?v=1");
  const c = await load(world);
  const st = await c.storage.session.get("active");
  assert.equal(st.active.domain, "youtube.com", "www. wird gestrippt, Tab sofort erfasst");

  tick(30_000);
  await fire(c, "alarm", { name: "flush" });
  assert.equal(totalFor(world.local, "youtube.com"), 30_000, "30s nach Alarm gebucht");
  console.log("1 OK  Start + Alarm-Flush");
}

// ---- 2. Idle stoppt – und Rueckkehr zaehlt wieder (Bug im Original) ---------
{
  const world = active("https://github.com/x");
  const c = await load(world);
  tick(10_000);

  world.idleState = "idle";
  await fire(c, "idle", "idle");
  assert.equal(totalFor(world.local, "github.com"), 10_000, "bis Idle gebucht");

  tick(600_000); // 10 min weg
  await fire(c, "alarm", { name: "flush" });
  assert.equal(totalFor(world.local, "github.com"), 10_000, "Idle-Zeit zaehlt nicht");

  world.idleState = "active";
  await fire(c, "idle", "active");
  tick(5_000);
  await fire(c, "alarm", { name: "flush" });
  assert.equal(totalFor(world.local, "github.com"), 15_000, "nach Idle wieder aktiv");
  console.log("2 OK  Idle stoppt und startet wieder");
}

// ---- 3. Fenster-Fokus verloren = andere App --------------------------------
{
  const world = active("https://news.ycombinator.com/");
  const c = await load(world);
  tick(8_000);

  world.window = { id: 1, focused: false };
  await fire(c, "focus", -1);
  tick(120_000);
  await fire(c, "alarm", { name: "flush" });
  assert.equal(totalFor(world.local, "news.ycombinator.com"), 8_000, "unfokussiert zaehlt nicht");
  console.log("3 OK  Fensterfokus");
}

// ---- 4. Tabwechsel bucht auf die richtige Domain ----------------------------
{
  const world = active("https://a.example/");
  const c = await load(world);
  tick(4_000);
  world.tab = { id: 6, url: "https://b.example/", active: true };
  await fire(c, "tabActivated", { tabId: 6 });
  tick(6_000);
  await fire(c, "alarm", { name: "flush" });
  assert.equal(totalFor(world.local, "a.example"), 4_000);
  assert.equal(totalFor(world.local, "b.example"), 6_000);
  console.log("4 OK  Tabwechsel");
}

// ---- 5. Nicht-trackbare URLs ------------------------------------------------
{
  const world = active("chrome://extensions");
  const c = await load(world);
  tick(5_000);
  await fire(c, "alarm", { name: "flush" });
  assert.deepEqual(world.local.usage, undefined, "chrome:// wird ignoriert");

  world.tab = { id: 7, url: undefined, active: true }; // Tab ohne URL
  await fire(c, "tabActivated", { tabId: 7 });
  tick(5_000);
  await fire(c, "alarm", { name: "flush" });
  console.log("5 OK  chrome:// und URL-lose Tabs stuerzen nicht ab");
}

// ---- 6. Standby: absurde Segmente werden verworfen --------------------------
{
  const world = active("https://sleep.example/");
  const c = await load(world);
  tick(8 * 60 * 60 * 1000); // Laptop 8h zugeklappt, kein Event gefeuert
  await fire(c, "alarm", { name: "flush" });
  assert.equal(totalFor(world.local, "sleep.example"), 0, "8h Standby nicht gebucht");
  console.log("6 OK  Standby-Schutz");
}

// ---- 7. Mitternacht splittet auf zwei Tage ---------------------------------
{
  now = new Date("2026-08-20T23:59:00").getTime();
  const world = active("https://late.example/");
  const c = await load(world);
  tick(120_000); // 2 min ueber Mitternacht
  await fire(c, "alarm", { name: "flush" });
  assert.equal(world.local.usage["2026-08-20"]["late.example"], 60_000);
  assert.equal(world.local.usage["2026-08-21"]["late.example"], 60_000);
  console.log("7 OK  Mitternacht-Split");
  now = new Date("2026-08-20T10:00:00").getTime();
}

// ---- 8. Migration vom alten Schema -----------------------------------------
{
  const world = active("https://new.example/");
  world.local = { "youtube.com": 3600, "old.example": 90, notanumber: "x" };
  const c = await load(world);
  await fire(c, "installed");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(world.local.usage["2026-08-20"]["youtube.com"], 3_600_000, "Sekunden -> ms");
  assert.equal(world.local.usage["2026-08-20"]["old.example"], 90_000);
  assert.equal(world.local["youtube.com"], undefined, "alte Keys entfernt");
  assert.equal(world.local.notanumber, "x", "Fremdkeys bleiben unangetastet");
  assert.equal(world.local.meta.schema, 2);
  console.log("8 OK  Migration");
}

// ---- 9. Popup-sync -----------------------------------------------------------
{
  const world = active("https://msg.example/");
  const c = await load(world);
  tick(3_000);
  const reply = await new Promise((res) => {
    const async_ = c._listeners.message({ type: "sync" }, {}, res);
    assert.equal(async_, true, "sendResponse asynchron => true zurueckgeben");
  });
  assert.deepEqual(reply, { ok: true });
  assert.equal(totalFor(world.local, "msg.example"), 3_000, "Popup erzwingt Abrechnung");
  console.log("9 OK  Popup-Nachricht");
}

console.log("\nAlle Tests bestanden.");
process.exit(0);
