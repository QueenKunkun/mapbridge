# Changelog

User-facing changes for MapBridge. Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- MapBridge exports now use a versioned `mapbridge` document with v2 `items`; existing v1 `mapbridge-places` files remain importable.
- Added an explicit provider-independent POI identity and runtime schemas for v2 point geometry.
- Added GPX 1.1 and KML 2.2 export for MapBridge POI items, with metadata preservation where supported.

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
