<div align="center">

<img src="site/assets/logo.png" width="96" alt="WebsiteTimeTrack">

# WebsiteTimeTrack

**Know where your time goes.**

A browser extension that measures how long you spend on every website — then
helps you stop. Daily limits, focus mode, categories and a weekly report.
Everything stays on your machine.

[![Website](https://img.shields.io/badge/website-timetrackerextension.vercel.app-2f8fff)](https://timetrackerextension.vercel.app)
[![Download](https://img.shields.io/badge/download-Chrome%20%7C%20Firefox-27ae60)](https://timetrackerextension.vercel.app/download.html)
[![Manifest](https://img.shields.io/badge/manifest-V3-5f6caf)](WebsiteTimeTrack/manifest.json)
[![Tests](https://img.shields.io/badge/tests-65%20passing-3fa96b)](WebsiteTimeTrack/test)
[![Dependencies](https://img.shields.io/badge/runtime%20deps-none-lightgrey)](package.json)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

---

## Install

Grab a ready-to-load ZIP — nothing to compile:

| Browser | Download | Then |
|---|---|---|
| **Chrome, Edge, Brave** | [`websitetimetrack-chrome.zip`](https://timetrackerextension.vercel.app/downloads/websitetimetrack-chrome.zip) | `chrome://extensions` → Developer mode → *Load unpacked* → the `chrome` folder |
| **Firefox** | [`websitetimetrack-firefox.zip`](https://timetrackerextension.vercel.app/downloads/websitetimetrack-firefox.zip) | `about:debugging` → *This Firefox* → *Load Temporary Add-on* → `firefox/manifest.json` |

Firefox drops temporary add-ons when it closes — load it again after a restart.

<details>
<summary>Building from source</summary>

```bash
npm run build     # writes dist/chrome and dist/firefox
npm run package   # the two ZIPs the website hands out, into site/downloads
npm test          # 65 tests, no dependencies
```

The unbuilt `WebsiteTimeTrack/` folder also loads directly in Chrome.
</details>

---

## What it does

### Measurement

| | |
| --- | --- |
| Time per domain | Stored per day, 365 days of history |
| Real activity only | Counts with an active tab, a focused window and a non-idle user |
| Interaction requirement | Optional: only count on mouse, keyboard or scroll |
| Audio exception | Tabs playing sound still count, so videos aren't read as a pause |
| Idle correction | The idle threshold is subtracted retroactively rather than counted |
| Midnight | Segments crossing 00:00 are split across both days |
| Standby protection | Segments over 5 minutes are treated as sleep and discarded |
| Ignore list | Domains that are never recorded at all, subdomains included |

### Beyond domains

| | |
| --- | --- |
| YouTube | Time per channel — the name comes from the content script |
| GitHub / GitLab | Time per repository |
| Reddit | Time per subreddit |
| Twitch, X | Time per channel or profile |
| Any domain | First path segment as a section, if you enable it |

### Insight, in the popup

| | |
| --- | --- |
| Ranges | Today, 7 days, 30 days, all time |
| Ranking | Sorted, with favicons and bars in the category colour |
| Expand | Click a domain to see its sub-entries |
| History | Bar chart of the last 30 days |
| Categories | Share per category, with percentage and time |
| Productivity score | 0–100, weighted by category |
| Delete one site | Removes a domain from every day, with a two-step confirm |
| Live | Refreshes every second while the popup is open |
| Dark mode | Auto / Light / Dark, in the popup and on the settings page |

### Limits, blocking, focus

| | |
| --- | --- |
| Daily limit per domain | In minutes, subdomains included |
| Early warning | Notification at a percentage you pick, 80 % by default |
| Blocking | Optional when the limit is reached, with its own block screen |
| Focus mode | Blocks distraction on demand, with an expiry time |
| Focus default | Without a list of your own, Social and Entertainment apply |
| Snooze | A 5-minute exception straight from the block screen |

### Categories and score

| | |
| --- | --- |
| Seven categories | Work, Learning, News, Shopping, Social, Entertainment, Other |
| Preassigned | Around 100 well-known domains are already categorised |
| Your own mapping | Changeable per domain, and it applies to subdomains too |
| Score | 50 is neutral; work and learning raise it, social and entertainment lower it |

### Report, export, sync

| | |
| --- | --- |
| Weekly report | Automatic on Mondays: total, top sites, categories, score, comparison to last week |
| CSV export | One row per day and domain, ready to pivot |
| JSON backup | Complete, including sub-entries and settings |
| Import | Merge or replace |
| Settings sync | Through your browser profile, with nothing to set up |
| Data sync | Optional, last N days, one area per device so it cannot conflict |

### Under the hood

| | |
| --- | --- |
| Storage | All local — `storage.local` for data, `storage.sync` for settings |
| Permissions | `tabs`, `storage`, `idle`, `alarms`, `notifications`, `favicon` |
| Retention | 365 days of domain data, 60 days of sub-entries, pruned automatically |
| Migration | Data from 1.0 and 1.1 is carried over on update |
| Firefox | Its own manifest, otherwise identical code |
| Tests | 65 tests with no dependencies (`npm test`) |

---

## Privacy

The extension makes **no network requests at all**. There is no account, no
server, no analytics and no telemetry. It reads the domain of the tab you are
looking at and writes times into your own browser storage — nothing else, and
nothing leaves your machine.

---

## Layout

```
WebsiteTimeTrack/
  manifest.json           Chrome (MV3, service worker)
  manifest.firefox.json   Firefox (MV3, event page)
  background.js           Segment measurement, limits, blocking, maintenance
  content.js              Interaction reporting + YouTube channel
  popup.*                 Ranking, history, categories
  options.*               Settings, categories, report, export
  blocked.*               Block screen with snooze
  lib/
    time.js         Day and week keys, formatting
    entity.js       Domain and sub-entry detection, pattern matching
    categories.js   Categories, default mapping, score
    settings.js     Defaults, reading and writing storage.sync
    storage.js      Schema, aggregation, migration, retention
    limits.js       Limits, notifications, block reasons
    report.js       Weekly report
    export.js       CSV, JSON, import
    sync.js         Device reconciliation
  test/                   65 tests
site/                     Static landing page
```

### Screenshots are generated, not mocked

`tools/screenshots.mjs` opens the extension's real pages in Chromium, replaces
the `chrome.*` APIs with sample data and photographs the result:

```bash
npm run screenshots     # needs playwright (devDependency)
```

Change the interface and the same command regenerates the images, so the
website cannot go stale. They are captured with dark mode forced
(`theme: "dark"` in the stub), independent of the host machine's theme.

---

## Version history

**2.1.0** — New logo across the extension icons, website and favicon. The
whole interface translated to English — popup, settings page, block screen,
notifications, CSV export; before this only the website was English while the
extension itself was German. Plus real dark mode: an Auto/Light/Dark toggle in
the popup and on the settings page, stored in `chrome.storage.sync` and cached
in `localStorage` so the page starts in the right theme instead of flashing
light first. Website screenshots retaken in dark mode.

**2.0.0** — Limits with notifications, blocking and focus mode; 30-day history;
categories with a productivity score; favicons; deleting individual domains; an
ignore list; a settings page; CSV/JSON export with import; the weekly report;
device reconciliation; sub-entries (YouTube channel, GitHub repo, subreddit); the
Firefox port; interaction detection via a content script.

Fixed along the way: switching to idle booked the full time until the next
alarm even though Chrome only reports the state after the threshold elapses.
The threshold is now subtracted, and with the interaction requirement on, a
segment ends at the end of the interaction window.

**1.1.0** — Bug fixes to the first release.

*Critical:* `setInterval` in the service worker (MV3 terminates it and the
timer dies with it) · state held only in module scope · nothing counted after
an idle period · nothing counted before the first tab switch · window focus was
ignored · Chart.js from a CDN was blocked by the MV3 CSP, so the chart never
appeared.

*Robustness:* crashes on closed tabs and tabs without a URL · systematic
undercounting from second-rounding · a write race condition · standby booked as
usage · a flat storage schema · `setDetectionInterval` never set.

*Popup:* unsorted · no auto-refresh · reset without confirmation · `formatTime`
always printed `0h 0m 42s`.

**1.0** — The original version.

---

## A note on the signing key

The original archive contained `WebsiteTimeTrack.pem`, the extension's private
signing key. It is deliberately not committed — whoever holds it can publish
updates under the same extension ID. `.gitignore` blocks `*.pem` and `*.crx`;
keep the file outside the repository.

---

## Links

- **Website** — <https://timetrackerextension.vercel.app>
- **Terms of Use** — <https://timetrackerextension.vercel.app/terms.html>
- **Downloads** — <https://timetrackerextension.vercel.app/download.html>
