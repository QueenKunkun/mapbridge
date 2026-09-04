# MapBridge

Migrate map favorites between Chinese map services (Baidu Maps ↔ Amap/AMap), directly in your browser.

Data stays local: the extension reads and writes favorites using the map site's own session, so **no cloud service, no upload, no API keys**.

> Currently verified: **Baidu Maps → Amap** extraction & import. Tencent Maps is not supported yet (hidden from the picker).

## Features

- **Extract favorites** from a signed-in favorites page by intercepting the site's own favorites API responses — no scraping the DOM, no fragile selectors.
- **Preview & edit** the extracted list (rename, filter, trim, dedupe) before importing.
- **Import** back into the target account by reusing the target page's session, merged with existing favorites (deduped by a deterministic coordinate+name fingerprint).
- **Coordinate conversion** across BD-09 (mercator) → GCJ-02 → WGS-84 so places land correctly on the other map.
- **Login-state detection**: the popup probes whether a favorites tab is open and logged in, showing a yellow "not logged in" warning when the session is missing (selectors verified against real logged-in/logged-out sessions).
- **Portable export**: export POI favorites as MapBridge JSON, GPX 1.1, or KML 2.2.
- **Dev tool** (dev build only): one-click backup + wipe of Amap favorites, for resetting test data.

## How it works

1. An ISOLATED content script bridges the extension to a MAIN-world executor on the map page.
2. Extraction: the MAIN executor captures the site's own favorites API responses (e.g. `getFav`/`favdata`) and normalizes them to a canonical `CanonicalPlace`.
3. Import: it reads the target's current favorites, merges the new places (keyed by `md5(point_x + "+" + point_y + "+" + name)`), and submits a single batch through the site's own sync endpoint.

Everything runs inside the page with the session you're already logged into.

## Install / development

```bash
pnpm install
pnpm dev:build      # builds the development version into .output/chrome-mv3
```

Then load the unpacked extension from `.output/chrome-mv3` via `chrome://extensions` → *Load unpacked*.

Production build (dev-only features tree-shaken):

```bash
pnpm build
pnpm test          # unit tests
pnpm compile       # typecheck
```

## Usage

1. Open the popup, pick **source → target** (e.g. Baidu Maps → Amap).
2. Open the source favorites page (the popup auto-detects open favorites tabs and their login state).
3. **Extract** → preview/edit the list → **Import** → view the report.

## Project layout

| Path | Purpose |
|---|---|
| `entrypoints/popup` | Migration wizard (select → extract → preview → import → report) |
| `entrypoints/options` | Settings, job history, adapter status, dev tools |
| `entrypoints/background` | Task orchestration, messaging, content-script bridge |
| `entrypoints/*-main.content.ts` | MAIN-world executors on each map page |
| `adapters/` | Per-platform normalize / import-payload builders |
| `core/` | Job state machine, dedup, coordinate conversion |
| `utils/` | Bridge protocol, messaging, storage helpers |

See `docs/01-architecture.md`–`docs/04-user-workflow.md` for design notes (internal).

## Roadmap

- [ ] Tencent Maps adapter (extraction & import)
- [ ] Baidu import adapter (export → re-import to Baidu)

## License

[Apache-2.0](LICENSE)
