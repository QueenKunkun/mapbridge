# Changelog

All notable changes to this project are documented here, following the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) spec. Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Baidu imports no longer report successful writes as failures: the favorites API returns a successful top-level `result.error: 0` while its created record uses `status: "100"`.
- Amap-to-Baidu imports now use Baidu's custom-place favorite format instead of creating invalid native-POI records without a Baidu POI UID; imported places can now open normally from the favorites list.
- Dev "Backup & wipe" could hang at "清空收藏…" when Amap dropped some `deletefav` callbacks under concurrent calls. Deletes are now serialized with a per-call timeout, and the result is derived from the real post-clear favorite count instead of the unreliable callback `status` field.

### Added
- Login-state detection in the popup: content scripts probe the map page DOM when answering `whoami`; a detected tab that is not logged in shows a yellow "未登录" warning instead of the green checkmark (selectors verified via CDP against logged-in and logged-out sessions).
- Version badge (`v0.1.0`) shown in the popup header, read from `browser.runtime.getManifest()`.
- Open-source release plan (Model B: on-air style dual-directory): `docs/06-open-source-release.md` (private).
- Options page redesigned in the Annoi style: dark theme with CSS-variable design tokens, sticky sidebar category nav (Settings / Data / About / Dev), card-based setting blocks via `SettingsBlock` (fullWidth/doubleWidth), responsive `repeat(auto-fill, minmax(340px, 1fr))` grid; job history and dev tools span the full row.
- Dev-only "Dev Tools" panel (options page, only visible in `import.meta.env.DEV` builds): one-click "Backup & wipe Amap favorites" — downloads a timestamped full backup JSON (favorites + `dir` folders + `ver`), then serially clears all favorites and verifies the remaining count; live progress is shown in the panel.
- DEV build badge ("DEV 构建") shown in the popup and options headers so dev builds are visually distinguishable.
- Popup wizard offers three modes: 迁移（地图→地图）、导出当前地图（提取并下载 JSON）、从文件导入（上传 MapBridge 导出文件 → 预览 → 导入）。
- 导入后可撤销：弹窗结果页与设置页"历史任务"均提供"撤销"按钮，仅删除本次实际写入目标地图的收藏（基于导入结果记录的 id），不会误删原有收藏；已撤销的任务标记"已撤销"。
- Project conventions persisted in `AGENTS.md` (English commit messages, English public docs, dev-build gating, release workflow).
- Settings button (⚙) in the popup header that opens the options page.
- Chinese `README.md` added as the primary readme; the English version lives at `README-en.md`.

### Changed
- Popup header logo ("MapBridge") reduced in size for a more compact header.
- Setup picker: source/target selects and the `→` arrow now share one row and are vertically centered.
- Popup platform picker hides the not-yet-supported Tencent Maps (`SELECTABLE_PROVIDERS` filters `tencent`); re-enable once the adapter lands.
- Popup auto-detects open favorites tabs (`whoami` probe): detection runs only for the selected source/target; when already detected, extract/import steps show "Detected ✓" and skip the open-page prompt.
- Baidu extraction auto-scrolls the favorites list to load all favorites (full list by default; can be trimmed in preview).
- Popup preview list scrolls internally with sticky footer buttons (avoids the `vh` feedback-loop collapse in auto-sized popups).
- Active tab id is refreshed before extract/import (`get-active-tab`), fixing imports silently hanging when the target opened in a new tab while the command went to a stale tab.
- Import progress changed from a percentage bar to phase status text (read existing → merge → sync → verify).
- Starting a new import auto-cancels previously stuck importing jobs, preventing `import-result` from being attached to the wrong job.
- Full-chain debug logging (`[mb:*]` prefix on background / ISOLATED / MAIN).
- Reusable dev scripts committed: `scripts/cdp_lib.py` (CDP connect/eval helper), `scripts/cdp_popup_e2e.py` (popup end-to-end flow).
- Incident postmortem: `docs/postmortem-001-import-stuck.md` (private).

### Fixed
- Options page now opens in a full browser tab (`manifest.open_in_tab` meta tag) instead of being embedded as a small dialog in `chrome://extensions`.
- Consistent popup spacing: removed the fixed `min-height: 100vh` from `body`/`#root` (which forced every step to stretch to the popup's max height and made button-bottom whitespace vary) and fixed the preview table's `max-height` that referenced `100vh`; button-bottom whitespace is now a uniform 16px across all steps (verified per step via `cdp_popup_geom`).
- WXT content-script entry naming switched to `*.content.ts` (`content-*.ts` fell into the catch-all and was never registered, making `tabs.sendMessage` fail with "Receiving end does not exist").
- Background now sends the `mb: '__mapbridge_v1__'` channel field on commands, fixing the MAIN world ignoring commands and the 15s extract timeout.
- Baidu favorites extraction adapted to the real `favdata` response shape (`sync.newdata` paging, `detail.data.extdata`, skipping `action:'del'`, address/phone parsing).

## [0.1.0] - 2026-08-19

### Added
- MapBridge extension skeleton (WXT + React): popup wizard (choose platforms → extract → preview/edit → import → result), options page, background job orchestration.
- Baidu ↔ Amap favorites migration core: extraction (MAIN-world interception of the favorites API responses) and import (session reuse calling `syncFaves` batch merge).
- Coordinates normalized to WGS-84 with BD-09 mercator → GCJ-02 → WGS-84 conversion.
- Job persistence (IndexedDB) with a draft/extracting/preview/importing/done/failed/cancelled state machine.
- Docs: `docs/01-architecture.md` ~ `docs/05-dev-testing.md` (with captured-protocol findings).
- Icons & branding: MapBridge name, SVG source + `scripts/gen-icons.sh` generating multi-size PNGs.
