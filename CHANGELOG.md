# Changelog

User-facing changes for MapBridge. Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Added Amap-to-Baidu Route import for driving, bus, walking, and cycling favorites.

### Fixed
- Grouped extraction warnings by reason on both the preview and result pages, limited the warning panel height, and added expandable source summaries to identify skipped records.
- Parsed Amap `type:102/103/104` Route records returned by the current favorites page instead of treating them as unsupported legacy data.
- Hid incomplete import-result statistics while an import is still running and added target-side duplicate detection for reverse Baidu migrations.

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
