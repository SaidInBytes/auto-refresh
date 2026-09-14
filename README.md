# Auto Refresh

A Manifest V3 Chrome extension that automatically refreshes the current tab
at a configurable interval. Plain HTML/CSS/JS only — no build step, no
external libraries.

## Features

- Set a refresh interval between **1 second and 5 minutes**, in seconds or minutes.
- Start / Stop per tab, with live status and countdown.
- Refresh state is strictly **per tab** — starting it in one tab never
  affects any other tab, and it survives page reloads in that same tab.
- Automatic language: the popup shows Swedish or English based on Chrome's
  language, with English as the fallback (see `_locales/`).
- Non-blocking warning for very short intervals (< 5 seconds).
- Graceful handling of pages where content scripts can't run (e.g. `chrome://`).

## File structure

```
manifest.json     Extension configuration (Manifest V3)
popup.html/.css/.js  Popup UI, validation, countdown display
content.js        Runs in the page; owns the actual refresh timer
background.js     Service worker; removes a tab's stored state when it closes
_locales/en, sv    UI text (chrome.i18n)
icons/             Toolbar/store icons + popup logo
```

## How it works

- State (`enabled`, `intervalSeconds`, `nextRefresh`, ...) is stored in
  `chrome.storage.local` under a single `refreshTabs` map keyed by tab id,
  e.g. `{ "refreshTabs": { "12": { "enabled": true, ... } } }`.
- `content.js` only ever reads/writes its own tab's entry, so one tab's
  timer can never start or stop refreshing another tab.
- `background.js` listens for `chrome.tabs.onRemoved` and deletes a closed
  tab's entry so stale tab ids never linger in storage.
- The popup talks to `content.js` via `chrome.tabs.sendMessage`, which
  already targets the exact tab the popup was opened for.

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Persist each tab's refresh state in `chrome.storage.local`. |
| `activeTab` | Read the active tab's id/URL when the popup opens, and to allow messaging it. |

`content_scripts` currently match `<all_urls>` so the extension works on any
page. If this will only ever be used on one operator site, replace
`"matches": ["<all_urls>"]` in `manifest.json` with that site's URL pattern
for a smaller permission footprint.

## Install / test locally

1. Go to `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this `operator-auto-refresh` folder.
4. Open any `http(s)://` page, click the extension icon, set an interval,
   and press **Start**.

## Known limitation

Refresh state lives in `chrome.storage.local`, which persists across page
reloads but is cleared like any local extension data if the extension is
removed. If Chrome itself is restarted, tabs are recreated with new tab ids,
so a previously "enabled" tab will not resume automatically after a full
browser restart — you'll need to press Start again.
