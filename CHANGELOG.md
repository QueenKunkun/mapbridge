# Changelog

User-facing changes for MapBridge. Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Fixed file-import preview navigation incorrectly returning to the map extraction step instead of the file-selection step.
- Fixed Amap POI matching progress remaining at `0/n` when the final progress and completion events arrived out of order.
- Restored active extraction, matching, preview, and import tasks when the popup is reopened, so closing the popup no longer makes an in-progress task appear lost.
- Restored the migration/file-import mode and the selected places/routes preview tab when reopening a persisted task.
- Preserved Routes when importing MapBridge JSON files, and prevented re-importing existing Amap favorites when provider IDs differ.
- Routed legacy Amap driving, transit, and walking favorites through the compatible sync API during re-import.
- Improved Amap duplicate matching for small coordinate conversion differences and exposed HTTP status details for Route sync failures.
- Added a configurable distance tolerance in meters for duplicate detection on supported map providers, with a safe default and maximum.
- Fixed the development Amap cleanup tool to use the verified delete API and report the actual backup and remaining counts.

### Changed
- Kept POI retry, diagnostics, and candidate selection controls stable after a candidate is selected.
- Placed POI diagnostics in a full-width expandable row and kept retry and candidate selection available after a match.
- Clarified settings scope and renamed the Amap batch-size setting; hid settings that are not yet connected to an active import behavior.
- Added in-place selection of a candidate when Amap POI matching finds multiple nearby results.
- Added a bounded setting for the maximum Amap POI matching distance, defaulting to 150 meters.
- Moved manual Amap POI matching into the Places preview table, with per-place status, retry actions, and coordinates available on hover.
- Kept the wizard footer limited to navigation controls; matching, refresh, and other task actions now stay in the page content.
- Shortened wizard back buttons to `Back`-equivalent labels so they remain compact and do not wrap in the popup.
- Standardized wizard navigation actions: previous on the left, the primary next action in the center, optional actions immediately before it, and cancel on the right.
- Added separate local settings for import request spacing and the upcoming Amap POI matching phase; import writes now honor the configured serial request interval with a safe bounded range.
- Added the first Amap POI matching flow: matching is explicitly started before import, uses conservative name-and-distance scoring, and keeps unmatched places as custom-coordinate favorites.
- Made Amap POI matching prefer the search strategy appropriate for the current page version, with the other strategy as a fallback when the first one fails.
- Added a previous-step action from preview back to extraction without discarding the current preview until extraction is explicitly started again.
- Added per-record Amap POI matching results so users can see which places use native POIs and which fall back to custom coordinates.
- Added a bounded scroll area for detailed matching results so large match lists do not expand the popup indefinitely.

## [0.5.1] - 2026-09-07

### Fixed
- Avoided large Amap import requests by sending only new places in parameter-limited batches.

### Changed
- Added a configurable maximum number of Amap POIs per sync batch, with a safe upper bound.

## [0.5.0] - 2026-09-05

### Added
- Added Route migration from Amap to Baidu for driving, bus, walking, and cycling favorites.
- Added undo support for imports into Baidu Maps.

### Changed
- Import progress now shows the current stage, processed count, and total count.
- Extraction warnings are grouped by reason, with expandable record details and a scrollable warning panel.

### Fixed
- Fixed Amap Route extraction for historical Route record formats returned by the current favorites page.
- Fixed repeated reverse migrations by refreshing the target favorites before duplicate detection and checking the final provider payload.

## [0.4.0] - 2026-09-05

### Added
- Added Amap Route import for recognized driving, bus, walking, and cycling routes.
- Added Route extraction and read-only previews for Amap SSR favorites.

### Changed
- Improved import reports with clearer success, duplicate, failure, and post-import total statistics.
- Improved export and import workflows with clearer labels and less crowded form layouts.

### Fixed
- Fixed Baidu Route extraction to recognize driving, bus, walking, and cycling routes.
- Fixed cycling Route migration by mapping it to Amap's verified riding favorite format.
- Fixed import undo for Amap's newer SSR pages, including accurate partial-failure reporting.
- Improved Amap login detection and KML folder import behavior.

## [0.3.0] - 2026-09-04

### Added
- Added versioned MapBridge JSON documents with POI and Route support while keeping v1 files importable.
- Added Baidu Route extraction and read-only Route previews, with Route export to GPX and KML.
- Added POI import and export for GPX 1.1 and KML 2.2, with clear warnings when unsupported route data or fields cannot be preserved.
- Added richer import reports that distinguish recognized items, import outcomes, unsupported Routes, and skipped source records.

### Changed
- Import previews now separate Places and Routes into dedicated tabs, and the primary next-step action is visually emphasized.
- POI matching and deduplication now use a stable provider-independent identity where available.

### Fixed
- Improved Amap login detection on the SSR favorites page by probing the read-only favorites endpoint before falling back to page markers.
- Improved detection refresh controls and clarified warnings for records already marked as deleted by the source map.
- Existing jobs and mixed documents now migrate or import supported POIs without silently discarding unsupported items.

## [0.2.1] - 2026-09-04

### Added
- feat: 百度自动导入（支持双向迁移）
- feat: 百度 POI 匹配（导入前自动匹配已有收藏）
- feat: 高德新版本 SSR 支持（CSRF token 修复）

### Fixed
- Amap import failing with "非法 token" on new SSR version (`ditu.amap.com/ssr/faves`) by sending `x-csrf-token` header in POST requests.

## [0.2.0] - 2026-08-24

### Added
- Export favorites from the current map as a MapBridge file.
- Import a MapBridge file into your selected map, with a chance to preview and edit places first.
- Undo a completed import from the result screen or job history.
- Transfer favorites from Amap to Baidu Maps.

### Improved
- Choose between migration, export, and file import directly from the popup.
- MapBridge remembers your last workflow and map selections.
- Migration steps and progress are easier to follow.

## [0.1.6] - 2026-08-22

### Improved
- Improved map-tab detection, login feedback, and the favorites migration flow.
- Added a clearer settings page.

## [0.1.0] - 2026-08-19

### Added
- First release of MapBridge with Baidu Maps to Amap favorites migration.
