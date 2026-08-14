# VoluMute

A browser extension (Chrome & Firefox) for managing volume: **auto-mute sites across devices** and **per-page / per-site volume control** (smooth 0–5x).

## Features

- **Auto mute** — Mark a site once and it's muted whenever you visit it. Settings live in `storage.sync`, so toggling it on any device applies everywhere.
- **Volume control** — Two independent levels:
  - *Page volume*: applies to a specific page URL (query/hash ignored)
  - *Site volume*: applies to the whole site
  - Multiplicative: effective volume = page volume × multiplier, adjustable 0–500% without steps
- **Priority**: auto mute > page volume > site volume (volume settings are ignored while muted)
- English & 中文, light & dark theme (follows system)
- Manage all settings in one place: site list, batch delete, export/import (merge or overwrite)

## Installation

Build the extension, then load it in developer mode:

```bash
pnpm install
pnpm build   # outputs dist/chrome and dist/firefox
```

| Browser | Steps |
|---|---|
| Chrome | `chrome://extensions` → enable Developer mode → *Load unpacked* → select `dist/chrome` |
| Firefox | `about:debugging` → *Load Temporary Add-on* → select `dist/firefox/manifest.json` |

> When testing `file://` pages, allow the extension to access file URLs in its settings.

## Usage

- **Popup** (click the toolbar icon): toggle auto mute for the current site, adjust page / site volume faders with live LED readout; open settings from the footer.
- **Options** (right-click the icon → Options): site list, data management (delete / export / import), language and theme.

## Notes

- Cross-device sync requires being signed in to the **same browser vendor** account (Chrome ↔ Chrome, Firefox ↔ Firefox).
- Volume is applied in-page via the Web Audio `GainNode`, so most streaming sites work without capture delay; sites that route their own audio through Web Audio may not be adjustable.
