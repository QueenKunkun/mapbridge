# Changelog

All notable changes to this project are documented here, following the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) spec. Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-08-24

### Added
- Export the current map's favorites as a portable MapBridge JSON file.
- Import MapBridge JSON files with preview and editing before writing to the selected map.
- Undo an import from the result screen or job history without affecting pre-existing favorites.
- Support Amap-to-Baidu imports, using native Baidu POI favorites when a match is found and custom-place favorites otherwise.

### Changed
- The popup now presents migration, export, and file-import as separate workflows, and remembers the last selection.
- Import and extraction steps detect eligible open map tabs and refresh the active tab before sending commands.

### Fixed
- Extraction now prefers live map API data, falls back safely to captured responses, and tolerates duplicate content-script handlers.
- Baidu imports correctly recognize successful API responses and do not create invalid native-POI records.
- Migration steps remain visible with compact, consistent popup spacing.

## [0.1.6] - 2026-08-22

### Added
- Login-state detection and a version badge in the popup.
- A redesigned settings page and development-only Amap backup-and-wipe tool.

### Changed
- The popup can automatically detect open favorites tabs, and its preview and import progress interfaces are easier to use.

### Fixed
- Options open in a full browser tab, content scripts register correctly, and Baidu favorites extraction handles the live response format.

## [0.1.0] - 2026-08-19

### Added
- MapBridge extension skeleton (WXT + React): popup wizard (choose platforms → extract → preview/edit → import → result), options page, background job orchestration.
- Baidu ↔ Amap favorites migration core: extraction (MAIN-world interception of the favorites API responses) and import (session reuse calling `syncFaves` batch merge).
- Coordinates normalized to WGS-84 with BD-09 mercator → GCJ-02 → WGS-84 conversion.
- Job persistence (IndexedDB) with a draft/extracting/preview/importing/done/failed/cancelled state machine.
- Docs: `docs/01-architecture.md` ~ `docs/05-dev-testing.md` (with captured-protocol findings).
- Icons & branding: MapBridge name, SVG source + `scripts/gen-icons.sh` generating multi-size PNGs.
