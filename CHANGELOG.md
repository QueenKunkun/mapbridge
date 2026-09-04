# Changelog

User-facing changes for MapBridge. Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- MapBridge exports now use a versioned `mapbridge` document with v2 `items`; existing v1 `mapbridge-places` files remain importable.
- Added an explicit provider-independent POI identity and runtime schemas for v2 point geometry.
- Added GPX 1.1 and KML 2.2 export for MapBridge POI items, with metadata preservation where supported.
- Added an internal Route schema based on confirmed Baidu route-favorite endpoints; Route items can now round-trip in v2 documents and export to GPX/KML, while provider import remains disabled.
- Portable GPX/KML exports now report fields that cannot be fully preserved, and their generated XML has structural regression coverage.
- Extraction jobs now retain recognized Route items and show them as unavailable for provider import while keeping the existing POI workflow.
- Route previews now show stop names, roles, coordinates, and travel mode; Route-only jobs cannot start provider import.
- File import now accepts GPX waypoints and KML Points, with explicit warnings when Route/LineString data is skipped.
- Portable POI imports now preserve exported identity and source record identifiers when those fields are available.
- Export mode now uses the unified extracted items, so recognized Routes are included in MapBridge, GPX, and KML exports.
- Provider adapters now declare item-kind extraction and import capabilities, with unsupported Route-only imports blocked explicitly.
- Extraction and portable-file warnings are now persisted with jobs and remain visible after reopening a task.
- Final import reports now show excluded unified items and retained extraction/file warnings.
- Import reports now distinguish raw extracted record counts from the POIs available for import.
- Previously saved jobs are migrated in memory with unified POI items and warning defaults when reopened.
- Baidu and Amap normalized POIs now carry the same deterministic cross-provider identity before entering migration jobs.
- POI deduplication now honors an explicit canonical identity and falls back to the deterministic coordinate fingerprint.
- Editing a POI name in preview now invalidates its old identity so deduplication can recalculate it safely.
- MapBridge files containing both supported POIs and unsupported item kinds now import the POIs while reporting the skipped items.

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
